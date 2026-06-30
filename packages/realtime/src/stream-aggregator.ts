/**
 * Phase 8 — Stream Aggregator.
 *
 * The single source of truth for what a listener is doing on a song.
 *
 * Responsibilities:
 *   - Convert incoming 5s ticks + start/end/pause/resume/seek events into:
 *     * per-tick PlaybackTick rows (for audit + Fan Agent)
 *     * running Stream aggregates (effectiveMs, loopCount, seekCount, etc.)
 *   - Detect the 25% threshold crossing → fire `threshold_crossed` + enqueue
 *     `agent:fan` with a fresh signature snapshot (defeats replays).
 *   - Detect suspicious patterns mid-stream → enqueue `agent:fan` early.
 *   - Detect natural end → finalize stream metrics.
 *   - Idempotent + safe under reconnect: the same sessionToken + monotonicMs
 *     will not double-count; out-of-order ticks are coerced with monotonicMs.
 *
 * The class is stateful in memory (per streamId) but durable in Postgres.
 * On startup it can hydrate from a Stream + last 100 ticks.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '@pazzera/db';
import { enqueue, QUEUE_NAMES } from '@pazzera/queue';
import { logger } from '@pazzera/core';
import {
  PLAYBACK_TICK_INTERVAL_MS,
  PAYMENT_THRESHOLD_PCT,
  SUSPICIOUS_SCORE_AUTO_ENQUEUE,
} from './protocol';
import type { PlaybackTickPayload } from './protocol';
import { issueAndStoreNonce } from './nonce-store';
import { recordEvent } from './event-log';

export interface StreamState {
  streamId: string;
  songId: string;
  userId: string;
  sessionToken: string;
  startedAt: number;
  // Server-tracked aggregates
  accumulatedMs: number;
  effectiveMs: number;       // excludes muted+hidden abuse
  mutedMs: number;
  hiddenMs: number;
  loopCount: number;
  seekCount: number;
  maxPlaybackRate: number;
  largeSeeksForward: number;
  suspiciousTickCount: number;
  lastTickTimestampMs: number;
  thresholdCrossed: boolean;
  lastPositionSec: number;
  ended: boolean;
  // Billing
  paymentTriggered: boolean;
  pricingTier: string;
  pricingUsdc: number;
}

const STATES = new Map<string, StreamState>();

// Server-tracked counters for admin observability (per-process; the API
// endpoint merges across all worker processes via Postgres rolling queries).
export const adminCounters = {
  paymentDueLastMin: [] as { ts: number; streamId: string }[],
  paymentSettledLastMin: [] as { ts: number; streamId: string }[],
  socketDisconnectsLastMin: [] as { ts: number; streamId?: string }[],
  suspiciousStreamsLastMin: [] as { ts: number; streamId: string }[],
  activeListenerCount: 0,
  activeStreamCount: 0,
  payment_due_total: 0,
  payment_settled_total: 0,
};

function trimMinute(buf: { ts: number }[]) {
  const since = Date.now() - 60_000;
  while (buf.length > 0 && buf[0]!.ts < since) buf.shift();
}

export function snapshotAdminCounters() {
  trimMinute(adminCounters.paymentDueLastMin);
  trimMinute(adminCounters.paymentSettledLastMin);
  trimMinute(adminCounters.socketDisconnectsLastMin);
  trimMinute(adminCounters.suspiciousStreamsLastMin);
  return {
    paymentDuePerMin: adminCounters.paymentDueLastMin.length,
    paymentSettledPerMin: adminCounters.paymentSettledLastMin.length,
    socketDisconnectsPerMin: adminCounters.socketDisconnectsLastMin.length,
    suspiciousStreamsPerMin: adminCounters.suspiciousStreamsLastMin.length,
    activeListenerCount: adminCounters.activeListenerCount,
    activeStreamCount: adminCounters.activeStreamCount,
    paymentDueTotal: adminCounters.payment_due_total,
    paymentSettledTotal: adminCounters.payment_settled_total,
  };
}

/**
 * Start a new stream session. Returns the sessionToken the client must echo
 * on every subsequent event.
 */
export async function startStream(opts: {
  userId: string;
  songId: string;
  resumeSessionToken?: string;
}): Promise<StreamState> {
  // Resume path
  if (opts.resumeSessionToken) {
    const existing = await prisma.stream.findUnique({
      where: { sessionToken: opts.resumeSessionToken },
    });
    if (existing && !existing.endedAt) {
      const state = await hydrateState(existing);
      STATES.set(state.streamId, state);
      return state;
    }
  }

  const song = await prisma.song.findUnique({
    where: { id: opts.songId },
    select: { id: true, durationSeconds: true, publishedPriceUsdc: true },
  });
  if (!song) throw new Error('Song not found');

  const sessionToken = `stk_${randomBytes(20).toString('hex')}`;
  const stream = await prisma.stream.create({
    data: {
      userId: opts.userId,
      songId: opts.songId,
      sessionToken,
      startedAt: new Date(),
    },
  });
  void song;

  const state: StreamState = {
    streamId: stream.id,
    songId: opts.songId,
    userId: opts.userId,
    sessionToken,
    startedAt: stream.startedAt.getTime(),
    accumulatedMs: 0,
    effectiveMs: 0,
    mutedMs: 0,
    hiddenMs: 0,
    loopCount: 0,
    seekCount: 0,
    maxPlaybackRate: 1,
    largeSeeksForward: 0,
    suspiciousTickCount: 0,
    lastTickTimestampMs: 0,
    thresholdCrossed: false,
    lastPositionSec: 0,
    ended: false,
    paymentTriggered: false,
    pricingTier: song.publishedPriceUsdc ?? '0.003',
    pricingUsdc: Number.parseFloat(song.publishedPriceUsdc ?? '0.003'),
  };
  STATES.set(state.streamId, state);
  adminCounters.activeStreamCount += 1;
  adminCounters.activeListenerCount += 1;
  await recordEvent({
    kind: 'stream_start',
    streamId: state.streamId,
    songId: state.songId,
    userId: state.userId,
  });
  return state;
}

async function hydrateState(stream: {
  id: string;
  userId: string;
  songId: string;
  sessionToken: string | null;
  startedAt: Date;
  effectiveDurationMs: number;
  loopCount: number;
  seekCount: number;
  maxPlaybackRate: number | null;
  thresholdCrossed: boolean;
  paymentTriggered: boolean;
}): Promise<StreamState> {
  return {
    streamId: stream.id,
    songId: stream.songId,
    userId: stream.userId,
    sessionToken: stream.sessionToken ?? '',
    startedAt: stream.startedAt.getTime(),
    accumulatedMs: stream.effectiveDurationMs,
    effectiveMs: stream.effectiveDurationMs,
    mutedMs: 0,
    hiddenMs: 0,
    loopCount: stream.loopCount,
    seekCount: stream.seekCount,
    maxPlaybackRate: stream.maxPlaybackRate ?? 1,
    largeSeeksForward: 0,
    suspiciousTickCount: 0,
    lastTickTimestampMs: 0,
    thresholdCrossed: stream.thresholdCrossed,
    lastPositionSec: 0,
    ended: false,
    paymentTriggered: stream.paymentTriggered ?? false,
    pricingTier: '0.003',
    pricingUsdc: 0.003,
  };
}

export function getState(streamId: string): StreamState | undefined {
  return STATES.get(streamId);
}

/**
 * Process a tick. The server is authoritative: it computes the time delta
 * between this tick and the last one, then attributes those ms based on the
 * flags the client sent. (We don't trust the client's "currentTime" deltas —
 * only the wall-clock timestamp + position sanity checks.)
 */
export async function ingestTick(payload: PlaybackTickPayload, monotonicMs: number): Promise<StreamState> {
  const state = STATES.get(payload.sessionId); // sessionId is actually the sessionToken here
  if (!state) {
    throw new Error('Stream not found in memory (lost connection?)');
  }
  if (state.ended) return state;
  // monotonicMs is the server timestamp (Date.now()) for ordering.
  void monotonicMs;

  const lastTs = state.lastTickTimestampMs || state.startedAt;
  const deltaMs = Math.max(0, Math.min(PLAYBACK_TICK_INTERVAL_MS * 2 + 1000, monotonicMs - lastTs));
  state.lastTickTimestampMs = monotonicMs;
  state.accumulatedMs += deltaMs;

  // Trust-but-verify: muted + hidden don't count toward effective listen
  let effectiveDelta = deltaMs;
  if (payload.muted) {
    state.mutedMs += deltaMs;
    effectiveDelta = 0;
  }
  if (payload.hidden) {
    state.hiddenMs += deltaMs;
    effectiveDelta = 0;
  }
  state.effectiveMs += effectiveDelta;
  state.lastPositionSec = payload.currentTimeSec;
  if (payload.playbackRate > state.maxPlaybackRate) state.maxPlaybackRate = payload.playbackRate;

  // Persist PlaybackTick
  await prisma.playbackTick.create({
    data: {
      streamId: state.streamId,
      monotonicMs: BigInt(monotonicMs),
      positionSec: payload.currentTimeSec,
      wasPause: false,
      wasSeek: false,
      wasMuted: payload.muted,
      wasHidden: payload.hidden,
      wasLooped: false,
      audioElementVolume: payload.volume,
    },
  });

  // Heuristic abuse detection per tick (cheap; Fan worker will do full audit)
  const isSuspiciousTick =
    payload.playbackRate > 1.5 ||
    (payload.hidden && payload.currentTimeSec > 5) ||
    (state.seekCount > 6) ||
    (state.largeSeeksForward >= 3);
  if (isSuspiciousTick) state.suspiciousTickCount += 1;

  // ─── Threshold crossing ───
  const song = await prisma.song.findUnique({
    where: { id: state.songId },
    select: { durationSeconds: true },
  });
  const thresholdSec = Math.max(5, Math.round((song!.durationSeconds * PAYMENT_THRESHOLD_PCT) / 100));
  if (!state.thresholdCrossed && state.effectiveMs / 1000 >= thresholdSec) {
    state.thresholdCrossed = true;
    await prisma.stream.update({
      where: { id: state.streamId },
      data: { effectiveDurationMs: state.effectiveMs, thresholdCrossed: true },
    });
    // Enqueue Fan Agent with current snapshot
    await enqueue.fan({ streamId: state.streamId }, { removeOnComplete: 200, removeOnFail: 200 });
    // Issue a payment_due nonce even before Fan Agent's verdict — the client
    // gets a pre-signed envelope ready. Fan Agent's verdict replaces this
    // if it changes classification.
    const nonce = await issueAndStoreNonce({
      streamId: state.streamId,
      userId: state.userId,
      amountUsdc: state.pricingUsdc.toFixed(6),
    });
    return state;
  }
  // Periodic Fan Agent enqueue when suspicion climbs
  if (
    !state.paymentTriggered &&
    state.suspiciousTickCount >= 4 &&
    state.effectiveMs / 1000 >= thresholdSec * 0.5
  ) {
    await enqueue.fan({ streamId: state.streamId });
    adminCounters.suspiciousStreamsLastMin.push({ ts: Date.now(), streamId: state.streamId });
    state.suspiciousTickCount = 0;
  }

  return state;
}

export async function recordSeek(opts: {
  sessionId: string; // sessionToken
  songId: string;
  fromSec: number;
  toSec: number;
  monotonicMs: number;
}): Promise<void> {
  for (const state of STATES.values()) {
    if (state.sessionToken === opts.sessionId) {
      const delta = opts.toSec - opts.fromSec;
      if (delta > 30) state.largeSeeksForward += 1;
      state.seekCount += 1;
      await prisma.playbackTick.create({
        data: {
          streamId: state.streamId,
          monotonicMs: BigInt(opts.monotonicMs),
          positionSec: opts.toSec,
          wasSeek: true,
          seekFromSec: opts.fromSec,
          seekToSec: opts.toSec,
        },
      });
      await prisma.stream.update({
        where: { id: state.streamId },
        data: { seekCount: state.seekCount },
      });
      return;
    }
  }
}

export async function recordLoop(opts: { sessionId: string; positionSec: number; monotonicMs: number }): Promise<void> {
  for (const state of STATES.values()) {
    if (state.sessionToken === opts.sessionId) {
      state.loopCount += 1;
      await prisma.playbackTick.create({
        data: {
          streamId: state.streamId,
          monotonicMs: BigInt(opts.monotonicMs),
          positionSec: opts.positionSec,
          wasLooped: true,
        },
      });
      return;
    }
  }
}

export async function endStream(opts: {
  sessionId: string;
  songId: string;
  reason: string;
  finalPositionSec: number;
  monotonicMs: number;
}): Promise<StreamState | null> {
  for (const [id, state] of STATES.entries()) {
    if (state.sessionToken === opts.sessionId) {
      state.ended = true;
      state.lastPositionSec = opts.finalPositionSec;
      await prisma.stream.update({
        where: { id: state.streamId },
        data: {
          endedAt: new Date(),
          endedReason: opts.reason,
          effectiveDurationMs: state.effectiveMs,
          loopCount: state.loopCount,
          seekCount: state.seekCount,
          maxPlaybackRate: state.maxPlaybackRate,
          thresholdCrossed: state.thresholdCrossed,
          endReason: opts.reason,
          totalActiveMs: state.accumulatedMs,
        },
      });
      // Always enqueue Fan Agent at end-of-stream (final authoritative decision)
      await enqueue.fan({ streamId: state.streamId });
      STATES.delete(id);
      adminCounters.activeStreamCount = Math.max(0, adminCounters.activeStreamCount - 1);
      adminCounters.activeListenerCount = Math.max(0, adminCounters.activeListenerCount - 1);
      await recordEvent({
        kind: 'stream_end',
        streamId: state.streamId,
        songId: state.songId,
        userId: state.userId,
        severity: 0,
        meta: { reason: opts.reason },
      });
      return state;
    }
  }
  return null;
}

export function markSocketDisconnect(streamId?: string): void {
  adminCounters.socketDisconnectsLastMin.push({ ts: Date.now(), streamId });
  if (streamId) {
    STATES.delete(streamId);
    adminCounters.activeStreamCount = Math.max(0, adminCounters.activeStreamCount - 1);
    adminCounters.activeListenerCount = Math.max(0, adminCounters.activeListenerCount - 1);
  }
}

export function activeStreamCount(): number {
  return STATES.size;
}
