/**
 * Phase 8 — Demo mode simulator.
 *
 * When DEMO_MODE=true, this runs in the realtime process:
 *   - 5 simulated listeners each start a fake stream per minute
 *   - ticks flood in from each at 5s intervals
 *   - threshold crossings happen (legitimate + suspicious patterns)
 *   - payment_due and payment_settled events fire into the admin feed
 *
 * The point is to make the dashboard appear alive during judges'
 * screencast without anyone clicking play.
 */
import { prisma } from '@pazzera/db';
import { enqueue } from '@pazzera/queue';
import { logger } from '@pazzera/core';
import { issueAndStoreNonce } from './nonce-store';
import { emitPaymentDue, emitPaymentSettled } from './server';
import { recordEvent } from './event-log';

const SIM_USER_IDS = [
  'demo_listener_alpha',
  'demo_listener_beta',
  'demo_listener_gamma',
  'demo_listener_delta',
  'demo_listener_epsilon',
];

const SIM_SONG_IDS: string[] = []; // populated on first run

async function pickSongIds(): Promise<string[]> {
  const songs = await prisma.song.findMany({
    where: { status: 'published' },
    select: { id: true },
    take: 5,
  });
  return songs.map((s: { id: string }) => s.id);
}

interface SimState {
  userId: string;
  streamId: string | null;
  songId: string;
  effectiveSec: number;
  thresholdCrossed: boolean;
  paymentTriggered: boolean;
  suspicionLevel: number; // 0..1
  interval?: ReturnType<typeof setInterval>;
}

const STATES: SimState[] = [];

export async function startDemoSimulator(): Promise<void> {
  if (process.env.DEMO_MODE !== 'true') return;
  if (STATES.length > 0) return;

  const songs = await pickSongIds();
  if (songs.length === 0) {
    logger.warn({ msg: 'demo-simulator no published songs; nothing to simulate' });
    return;
  }
  for (let i = 0; i < SIM_USER_IDS.length; i++) {
    const state: SimState = {
      userId: SIM_USER_IDS[i]!,
      streamId: null,
      songId: songs[i % songs.length]!,
      effectiveSec: 0,
      thresholdCrossed: false,
      paymentTriggered: false,
      suspicionLevel: i === 1 ? 0.3 : 0, // one simulated fraudulent listener
    };
    STATES.push(state);
  }
  for (const state of STATES) {
    await spawnStream(state);
  }
  logger.info({ count: STATES.length }, 'demo-simulator:running');
}

async function spawnStream(state: SimState): Promise<void> {
  try {
    const stream = await prisma.stream.create({
      data: {
        userId: state.userId,
        songId: state.songId,
        sessionToken: `sim-${state.userId}-${Date.now()}`,
        startedAt: new Date(),
      },
    });
    state.streamId = stream.id;
    state.effectiveSec = 0;
    state.thresholdCrossed = false;
    state.paymentTriggered = false;
    await recordEvent({ kind: 'stream_start', streamId: stream.id, songId: state.songId, userId: state.userId });
  } catch (err) {
    logger.warn({ err }, 'demo-simulator:spawn_failed');
  }
}

export function tickDemoSimulator(): void {
  for (const state of STATES) {
    if (!state.streamId) continue;
    state.effectiveSec += 5;
    // Compute the threshold (25%)
    // We hardcode 50s here for demo speed
    const thresholdSec = 50;
    if (!state.thresholdCrossed && state.effectiveSec >= thresholdSec) {
      state.thresholdCrossed = true;
      // Emit payment_due
      const amountUsdc = state.suspicionLevel > 0 ? '0.002' : '0.003';
      (async () => {
        const nonce = await issueAndStoreNonce({
          streamId: state.streamId!,
          userId: state.userId,
          amountUsdc,
        });
        await emitPaymentDue({
          streamId: state.streamId!,
          songId: state.songId,
          amountUsdc,
          pricingTier: '0.003',
          authorizationRequired: true,
          nonce,
        });
        // 1 second later, fire payment_settled
        setTimeout(async () => {
          if (!state.streamId) return;
          await emitPaymentSettled(state.streamId, {
            paymentId: `pay-demo-${state.streamId}`,
            songId: state.songId,
            amountUsdc,
            recipientCount: 3,
            txHash: `0xdemo${Math.random().toString(16).slice(2, 10)}`,
            payoutStatus: state.suspicionLevel > 0.2 ? 'partial_failure' : 'completed',
          });
          state.paymentTriggered = true;
          // 30s later, end + spawn new stream
          setTimeout(async () => {
            await prisma.stream.update({
              where: { id: state.streamId! },
              data: { endedAt: new Date(), endedReason: 'natural', effectiveDurationMs: state.effectiveSec * 1000 },
            }).catch(() => undefined);
            state.streamId = null;
            setTimeout(() => void spawnStream(state), 3_000);
          }, 30_000);
        }, 1_000);
      })().catch((e) => logger.warn({ err: e }, 'demo-simulator'));
    }
  }
}

let demoInterval: ReturnType<typeof setInterval> | null = null;

export function startDemoLoop(): void {
  if (demoInterval) return;
  if (process.env.DEMO_MODE !== 'true') return;
  void startDemoSimulator();
  demoInterval = setInterval(tickDemoSimulator, 5_000);
}

export function stopDemoLoop(): void {
  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
  }
}
