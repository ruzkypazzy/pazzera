/**
 * Fan Agent — pure decision function.
 *
 * Outputs:
 *   - shouldCharge: true → proceed to payment settlement
 *   - fraudScore:   0–100, persisted on Stream for admin dashboards
 *   - signals:      breakdown of contributing signals
 *   - manualReview: if fraudScore >= threshold, payment enters manual review
 *
 * Signal catalog:
 *   loop_play        — re-entering threshold region from the end
 *   muted_play       — sustained muted playback
 *   hidden_play      — tab background / window minimized
 *   device_repeat    — same fingerprint across many users
 *   ip_repeat        — many users from same IP
 *   farm_pattern     — many streams in a short window
 *   abnormal_speed   — playback speed implausibly high
 *   seek_abuse       — repeated large seeks in window
 *   position_lie     — reported position > tick-derived maximum
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
  ticks: {
    monotonicMs: number;
    positionSec: number;
    wasSeek: boolean;
    wasPause: boolean;
    wasMuted?: boolean;
    wasHidden?: boolean;
    wasLooped?: boolean;
    audioElementVolume?: number | null;
  }[];
  largeSeekCount: number;
  activeMs: number;
  hasRecentConcurrentStream: boolean;
  // User-level history (joined in by worker)
  userHistory: {
    streamsLast1h: number;
    streamsLast24h: number;
    uniqueDevicesLast7d: number;
    uniqueIpsLast7d: number;
    priorFraudScoreAvg: number;
    accountAgeDays: number;
  };
  // Stream connection context
  ipAddress: string | null;
  deviceFingerprintId: string | null;
  deviceFingerprintUserCount: number; // how many distinct users share this fingerprint
}

export interface FanSignal {
  type: string;
  severity: number; // 0–100 contribution to total fraud score
  meta?: Record<string, unknown>;
}

export interface FanDecision {
  shouldCharge: boolean;
  manualReview: boolean;
  fraudScore: number;     // 0–100
  signals: FanSignal[];
  reason: string;
}

export const FRAUD_THRESHOLD_AUTO_REJECT = 80;
export const FRAUD_THRESHOLD_MANUAL_REVIEW = 50;

export function decideFan(
  payload: FanJobPayload,
  ctx: FanStreamContext,
): FanDecision {
  if (ctx.charged) {
    return mk(false, false, 0, [], 'already_charged');
  }
  if (ctx.flaggedAbuse) {
    return mk(false, true, 100, [{ type: 'previously_flagged', severity: 100 }], 'flagged_abuse');
  }
  if (ctx.ticks.length < 3) {
    return mk(false, false, 0, [], 'insufficient_ticks');
  }
  if (ctx.activeMs < 30_000) {
    return mk(false, false, 0, [], 'below_min_active_time');
  }

  const requiredSec = ctx.durationSeconds * 0.25;
  const maxPosition = ctx.ticks.reduce((m, t) => Math.max(m, t.positionSec), 0);
  if (maxPosition < requiredSec) {
    return mk(false, false, 0, [], 'position_below_threshold');
  }

  const signals: FanSignal[] = [];

  // ─── Loop play (re-entering threshold region from end) ────────
  const loopedTicks = ctx.ticks.filter((t) => t.wasLooped).length;
  if (loopedTicks > 0) {
    signals.push({ type: 'loop_play', severity: Math.min(40, 10 * loopedTicks) });
  }

  // ─── Muted playback ────────────────────────────────────────────
  const mutedTicks = ctx.ticks.filter((t) => t.wasMuted).length;
  if (mutedTicks > ctx.ticks.length * 0.5) {
    signals.push({ type: 'muted_play', severity: 35, meta: { ratio: mutedTicks / ctx.ticks.length } });
  }
  // Sustained volume < 0.05 with >5 ticks
  const lowVolTicks = ctx.ticks.filter(
    (t) => t.audioElementVolume !== null && t.audioElementVolume !== undefined && t.audioElementVolume < 0.05,
  ).length;
  if (lowVolTicks > 5) {
    signals.push({ type: 'low_volume_sustained', severity: 15 });
  }

  // ─── Hidden / background tab ───────────────────────────────────
  const hiddenTicks = ctx.ticks.filter((t) => t.wasHidden).length;
  if (hiddenTicks > ctx.ticks.length * 0.6) {
    signals.push({ type: 'hidden_play', severity: 30, meta: { ratio: hiddenTicks / ctx.ticks.length } });
  }

  // ─── Seek abuse ────────────────────────────────────────────────
  if (ctx.largeSeekCount > 2) {
    signals.push({ type: 'seek_abuse', severity: Math.min(50, 12 * ctx.largeSeekCount) });
  }

  // ─── Position lie (pos delta vs elapsed) ───────────────────────
  // (basic check; deeper check is in the realtime layer)
  let positionLies = 0;
  for (let i = 1; i < ctx.ticks.length; i++) {
    const prev = ctx.ticks[i - 1]!;
    const cur = ctx.ticks[i]!;
    const elapsed = (cur.monotonicMs - prev.monotonicMs) / 1000;
    const delta = cur.positionSec - prev.positionSec;
    if (delta > elapsed * 1.2 + 0.5) positionLies++;
  }
  if (positionLies > 0) {
    signals.push({ type: 'position_lie', severity: Math.min(40, 10 * positionLies) });
  }

  // ─── Farm pattern: streams-per-hour ────────────────────────────
  if (ctx.userHistory.streamsLast1h > 8) {
    signals.push({
      type: 'farm_pattern',
      severity: Math.min(60, (ctx.userHistory.streamsLast1h - 8) * 6),
      meta: { streamsLast1h: ctx.userHistory.streamsLast1h },
    });
  } else if (ctx.userHistory.streamsLast1h > 4) {
    signals.push({ type: 'elevated_volume', severity: 10, meta: { streamsLast1h: ctx.userHistory.streamsLast1h } });
  }

  // ─── Device repetition ─────────────────────────────────────────
  if (ctx.deviceFingerprintUserCount > 1) {
    signals.push({
      type: 'device_repeat',
      severity: Math.min(40, 15 * ctx.deviceFingerprintUserCount),
      meta: { sharedUserCount: ctx.deviceFingerprintUserCount },
    });
  }

  // ─── IP repetition (very rough; reverse proxies confound this) ─
  if (ctx.userHistory.uniqueIpsLast7d > 4) {
    signals.push({
      type: 'ip_repeat',
      severity: Math.min(30, 6 * ctx.userHistory.uniqueIpsLast7d),
    });
  }

  // ─── Concurrent streams ────────────────────────────────────────
  if (ctx.hasRecentConcurrentStream) {
    signals.push({ type: 'concurrent_stream', severity: 25 });
  }

  // ─── New account + high volume ─────────────────────────────────
  if (ctx.userHistory.accountAgeDays < 1 && ctx.userHistory.streamsLast24h > 5) {
    signals.push({ type: 'new_account_high_volume', severity: 25 });
  }

  // ─── Sum ───────────────────────────────────────────────────────
  const fraudScore = Math.min(
    100,
    signals.reduce((s, sig) => s + sig.severity, 0),
  );

  if (fraudScore >= FRAUD_THRESHOLD_AUTO_REJECT) {
    return mk(false, false, fraudScore, signals, 'auto_reject_fraud');
  }
  if (fraudScore >= FRAUD_THRESHOLD_MANUAL_REVIEW) {
    return mk(false, true, fraudScore, signals, 'manual_review');
  }

  return mk(true, false, fraudScore, signals, 'eligible');
}

function mk(
  shouldCharge: boolean,
  manualReview: boolean,
  fraudScore: number,
  signals: FanSignal[],
  reason: string,
): FanDecision {
  return { shouldCharge, manualReview, fraudScore, signals, reason };
}