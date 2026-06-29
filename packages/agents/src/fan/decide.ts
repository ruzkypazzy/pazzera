/**
 * Fan Agent — pure decision function.
 *
 * Decides whether a stream that crossed the threshold should actually be
 * charged. This is the second-line anti-fraud check beyond the realtime
 * tick logic.
 */
import type { FanJobPayload } from '@pazzera/queue';

export interface FanStreamContext {
  streamId: string;
  userId: string;
  songId: string;
  durationSeconds: number;
  startedAt: Date;
  endedAt: Date | null;
  charged: boolean;
  flaggedAbuse: boolean;
  /** All server-recorded playback ticks for this stream. */
  ticks: { monotonicMs: number; positionSec: number; wasSeek: boolean; wasPause: boolean }[];
  /** Number of recent ticks classified as seeks (>5s jump). */
  largeSeekCount: number;
  /** Total wall-clock active time (excludes paused windows). */
  activeMs: number;
  /** True if user has another stream in the last 60s. */
  hasRecentConcurrentStream: boolean;
}

export interface FanDecision {
  shouldCharge: boolean;
  reason: string;
}

export function decideFan(
  payload: FanJobPayload,
  ctx: FanStreamContext,
): FanDecision {
  // Already charged? noop.
  if (ctx.charged) {
    return { shouldCharge: false, reason: 'already_charged' };
  }
  if (ctx.flaggedAbuse) {
    return { shouldCharge: false, reason: 'flagged_abuse' };
  }
  if (ctx.ticks.length < 3) {
    return { shouldCharge: false, reason: 'insufficient_ticks' };
  }
  // Must have been active for at least 30s wall clock
  if (ctx.activeMs < 30_000) {
    return { shouldCharge: false, reason: 'below_min_active_time' };
  }
  // Must have ticked through at least 25% of duration (already enforced at threshold,
  // but verify the playback actually traversed that range, not just seeked through)
  const maxPositionReached = ctx.ticks.reduce((m, t) => Math.max(m, t.positionSec), 0);
  const requiredSec = ctx.durationSeconds * 0.25;
  if (maxPositionReached < requiredSec) {
    return { shouldCharge: false, reason: 'position_below_threshold' };
  }
  // Excessive seeking → abuse
  if (ctx.largeSeekCount > 2) {
    return { shouldCharge: false, reason: 'excessive_seeks' };
  }
  // Concurrent streams from same user
  if (ctx.hasRecentConcurrentStream) {
    return { shouldCharge: false, reason: 'concurrent_stream' };
  }

  return { shouldCharge: true, reason: 'eligible' };
}