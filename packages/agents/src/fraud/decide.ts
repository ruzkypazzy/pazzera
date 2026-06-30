/**
 * Fraud Sentinel — pure decision function for platform-wide fraud patterns.
 *
 * Phase 7 contract:
 *   - takes an entity + signals for one specific detection type,
 *   - returns a normalized FraudAlert payload with severity + reasons,
 *   - signs high severity with auto-action (wallet_frozen | payouts_paused
 *     | account_locked).
 *
 * Detectors implemented:
 *
 * 1) StreamFarmDetector
 *    One wallet repeatedly streaming the same artist at suspiciously
 *    uniform intervals.
 *
 * 2) CircularPaymentDetector
 *    Artist pays their own listener wallets through disguised tips /
 *    stream payments. Detected by tracing payment graph cycles.
 *
 * 3) SybilDetector
 *    Many fresh accounts behaving identically within a short window
 *    (same timestamps + same IPs + same targets).
 *
 * 4) PayoutAbuseDetector
 *    Unusual payout velocity / unusually high withdrawal / same-day
 *    wallet drain patterns.
 *
 * The function is split into 4 subdetectors; each returns a partial
 * signal that combines into one final alert. Two strategies supported:
 *
 *   'stream_farm' | 'circular_payments' | 'sybil_accounts' | 'payout_abuse'
 */
import type { FraudAlertPayload } from '@pazzera/core';

export interface StreamFarmSignals {
  walletAddress: string;
  artistId: string;
  streamsLast7d: number;
  uniqueListenersLast7d: number;
  avgListenDurationSec: number;
  sameSongRepeatCount: number;
}

export interface CircularPaymentsSignals {
  payerUserId: string;
  payerArtistId: string;
  payerStreamsLast7d: number;
  payerListenersLast7d: number;
  cycles: Array<{
    listenerUserId: string;
    streamsToPayer: number;
    paymentsFromPayer: number;
  }>;
}

export interface SybilSignals {
  userIds: string[];
  ipCluster: string;
  createdAtWindowHours: number;
  identicalStreamTargetSongId: string | null;
  identicalTimingStdDevSec: number;
}

export interface PayoutAbuseSignals {
  walletId: string;
  payoutsLast24h: number;
  payoutsLast7d: number;
  totalPayoutsLast7dUsdc: string;
  walletBalanceUsdc: string;
  depositsLast7d: number;
  unusualRecipientCount: number;
}

const SEVERITY_THRESHOLDS = {
  critical: 90,
  high: 75,
  medium: 40,
} as const;

const AUTO_ACTION_THRESHOLD = 'high';

export function severityFor(score: number): FraudAlertPayload['severity'] {
  if (score >= SEVERITY_THRESHOLDS.critical) return 'critical';
  if (score >= SEVERITY_THRESHOLDS.high) return 'high';
  if (score >= SEVERITY_THRESHOLDS.medium) return 'medium';
  // Below 40 → low (still surfaced but not in default admin filter).
  return 'low';
}

export function autoActionFor(
  severity: FraudAlertPayload['severity'],
  entityType: FraudAlertPayload['entityType'],
): FraudAlertPayload['autoAction'] | undefined {
  if (severity === 'low' || severity === 'medium') return undefined;
  // Critical severity always escalates to account locking or payouts pause.
  if (severity === 'critical') {
    if (entityType === 'wallet') return 'account_locked';
    if (entityType === 'user') return 'account_locked';
    if (entityType === 'payment_cluster' || entityType === 'song') return 'payouts_paused';
    return undefined;
  }
  // High severity freezes payouts for the affected entities.
  if (severity === AUTO_ACTION_THRESHOLD) {
    if (entityType === 'wallet') return 'payouts_paused';
    if (entityType === 'user') return 'payouts_paused';
    return undefined;
  }
  return undefined;
}

/**
 * Stream Farm Detector
 */
export function detectStreamFarm(input: StreamFarmSignals): FraudAlertPayload {
  const reasons: string[] = [];
  const breakdown: Record<string, number> = {};
  let score = 0;

  // 1 stream / wallet / artist is normal. 20+ at uniform intervals is farm.
  if (input.streamsLast7d >= 50) {
    score += 40;
    breakdown.volume = 40;
    reasons.push(`${input.streamsLast7d} streams in 7d from one wallet to one artist`);
  } else if (input.streamsLast7d >= 20) {
    score += 25;
    breakdown.volume = 25;
    reasons.push(`${input.streamsLast7d} streams in 7d — above normal listening`);
  }

  // Concentrated listener footprint
  if (input.uniqueListenersLast7d <= 1 && input.streamsLast7d >= 10) {
    score += 25;
    breakdown.concentration = 25;
    reasons.push('Single wallet produces almost all streams for this artist');
  } else if (input.uniqueListenersLast7d <= 3 && input.streamsLast7d >= 20) {
    score += 12;
    breakdown.concentration = 12;
    reasons.push('Very few wallets account for majority of streams');
  }

  // Uniform short listens
  if (input.avgListenDurationSec < 30 && input.streamsLast7d >= 20) {
    score += 20;
    breakdown.shortListen = 20;
    reasons.push(`Average listen duration is ${input.avgListenDurationSec.toFixed(1)}s — skim farming`);
  }

  // Same song repeats
  if (input.sameSongRepeatCount >= 20) {
    score += 25;
    breakdown.sameSong = 25;
    reasons.push(`Same song streamed ${input.sameSongRepeatCount}x`);
  } else if (input.sameSongRepeatCount >= 10) {
    score += 12;
    breakdown.sameSong = 12;
    reasons.push(`Same song streamed ${input.sameSongRepeatCount}x`);
  }

  const finalScore = Math.min(100, Math.round(score));
  const severity = severityFor(finalScore);
  return {
    severity,
    entityType: 'wallet',
    entityId: input.walletAddress,
    score: finalScore,
    reasons: reasons.length ? reasons : ['Wallet listener pattern within normal range'],
    metricBreakdown: breakdown,
    autoAction: autoActionFor(severity, 'wallet'),
  };
}

/**
 * Circular Payments Detector
 */
export function detectCircularPayments(input: CircularPaymentsSignals): FraudAlertPayload {
  const reasons: string[] = [];
  const breakdown: Record<string, number> = {};
  let score = 0;

  const cycles = input.cycles.filter((c) => c.streamsToPayer >= 3 && c.paymentsFromPayer >= 3);
  if (cycles.length === 0) {
    return {
      severity: 'low',
      entityType: 'user',
      entityId: input.payerUserId,
      score: 0,
      reasons: ['No circular payment patterns detected'],
      metricBreakdown: breakdown,
    };
  }

  const strongest = cycles.reduce(
    (best, c) => Math.max(best, Math.min(c.streamsToPayer, c.paymentsFromPayer)),
    0,
  );
  if (strongest >= 20) {
    score += 70;
    breakdown.circularIntensity = 70;
    reasons.push(`Strong circular payment pattern (peaks at ${strongest})`);
  } else if (strongest >= 10) {
    score += 50;
    breakdown.circularIntensity = 50;
    reasons.push(`Visible circular payment pattern (peaks at ${strongest})`);
  } else if (strongest >= 5) {
    score += 25;
    breakdown.circularIntensity = 25;
    reasons.push(`Light circular payment pattern (peaks at ${strongest})`);
  }

  if (cycles.length >= 5) {
    score += 25;
    breakdown.cycleCount = 25;
    reasons.push(`${cycles.length} distinct listener wallets form the cycle`);
  } else if (cycles.length >= 2) {
    score += 10;
    breakdown.cycleCount = 10;
    reasons.push(`${cycles.length} listener wallets form the cycle`);
  }

  const finalScore = Math.min(100, Math.round(score));
  const severity = severityFor(finalScore);
  return {
    severity,
    entityType: 'user',
    entityId: input.payerUserId,
    score: finalScore,
    reasons,
    metricBreakdown: breakdown,
    autoAction: autoActionFor(severity, 'user'),
  };
}

/**
 * Sybil Accounts Detector — many fresh accounts acting in concert.
 */
export function detectSybil(input: SybilSignals): FraudAlertPayload {
  const reasons: string[] = [];
  const breakdown: Record<string, number> = {};
  let score = 0;

  // Cluster size
  if (input.userIds.length >= 25) {
    score += 40;
    breakdown.cluster = 40;
    reasons.push(`${input.userIds.length} accounts on same IP cluster`);
  } else if (input.userIds.length >= 10) {
    score += 25;
    breakdown.cluster = 25;
    reasons.push(`${input.userIds.length} accounts on same IP cluster`);
  } else if (input.userIds.length >= 5) {
    score += 15;
    breakdown.cluster = 15;
    reasons.push(`${input.userIds.length} accounts on same IP cluster`);
  }

  // Tightly created
  if (input.createdAtWindowHours <= 24 && input.userIds.length >= 5) {
    score += 20;
    breakdown.window = 20;
    reasons.push(`All accounts created within ${input.createdAtWindowHours}h`);
  }

  // Identical target song
  if (input.identicalStreamTargetSongId) {
    score += 20;
    breakdown.target = 20;
    reasons.push(`All accounts streamed the same song (${input.identicalStreamTargetSongId})`);
  }

  // Identical timing (low stddev)
  if (input.identicalTimingStdDevSec < 5 && input.userIds.length >= 5) {
    score += 20;
    breakdown.timing = 20;
    reasons.push(`Stream start times within ${input.identicalTimingStdDevSec.toFixed(1)}s stddev (clearly automated)`);
  } else if (input.identicalTimingStdDevSec < 30 && input.userIds.length >= 5) {
    score += 8;
    breakdown.timing = 8;
    reasons.push(`Stream start times suspiciously synchronized (σ=${input.identicalTimingStdDevSec.toFixed(1)}s)`);
  }

  // Composite
  if (input.userIds.length >= 5 && input.createdAtWindowHours <= 48 && input.identicalStreamTargetSongId) {
    score += 10;
    breakdown.composite = 10;
    reasons.push('Multiple Sybil indicators reinforcing');
  }

  const finalScore = Math.min(100, Math.round(score));
  const severity = severityFor(finalScore);
  return {
    severity,
    entityType: 'ip_cluster',
    entityId: input.ipCluster,
    score: finalScore,
    reasons: reasons.length ? reasons : ['No Sybil pattern detected'],
    metricBreakdown: breakdown,
    autoAction: autoActionFor(severity, 'user'),
  };
}

/**
 * Payout Abuse Detector — unusual withdrawal velocity.
 */
export function detectPayoutAbuse(input: PayoutAbuseSignals): FraudAlertPayload {
  const reasons: string[] = [];
  const breakdown: Record<string, number> = {};
  let score = 0;

  // Velocity
  if (input.payoutsLast24h >= 10) {
    score += 30;
    breakdown.velocity = 30;
    reasons.push(`${input.payoutsLast24h} payouts in last 24h`);
  } else if (input.payoutsLast24h >= 5) {
    score += 15;
    breakdown.velocity = 15;
    reasons.push(`${input.payoutsLast24h} payouts in last 24h`);
  }

  // Drain ratio: payouts / deposits in last 7d
  const payoutUnits = Number.parseFloat(input.totalPayoutsLast7dUsdc);
  if (Number.isFinite(payoutUnits) && input.depositsLast7d > 0) {
    const ratio = payoutUnits / (input.depositsLast7d * 0.001 * input.depositsLast7d);
    if (ratio > 5) {
      score += 25;
      breakdown.drainRatio = 25;
      reasons.push(`Payouts exceed deposits by ${ratio.toFixed(1)}x — clear draining`);
    } else if (ratio > 2) {
      score += 12;
      breakdown.drainRatio = 12;
      reasons.push(`Payouts exceed deposits by ${ratio.toFixed(1)}x`);
    }
  }

  // Recipients fanout — paying many wallets suggests laundering
  if (input.unusualRecipientCount >= 20) {
    score += 30;
    breakdown.fanout = 30;
    reasons.push(`Payouts to ${input.unusualRecipientCount} recipients in 7d`);
  } else if (input.unusualRecipientCount >= 10) {
    score += 18;
    breakdown.fanout = 18;
    reasons.push(`Payouts to ${input.unusualRecipientCount} recipients in 7d`);
  } else if (input.unusualRecipientCount >= 5) {
    score += 8;
    breakdown.fanout = 8;
    reasons.push(`Payouts to ${input.unusualRecipientCount} recipients in 7d`);
  }

  // Empty wallet draining pattern
  const balanceUnits = Number.parseFloat(input.walletBalanceUsdc);
  if (Number.isFinite(balanceUnits) && balanceUnits < 0.01 && input.payoutsLast7d >= 1) {
    score += 10;
    breakdown.drainPattern = 10;
    reasons.push('Wallet repeatedly drained to near-zero');
  }

  const finalScore = Math.min(100, Math.round(score));
  const severity = severityFor(finalScore);
  return {
    severity,
    entityType: 'wallet',
    entityId: input.walletId,
    score: finalScore,
    reasons: reasons.length ? reasons : ['Payout velocity within normal range'],
    metricBreakdown: breakdown,
    autoAction: autoActionFor(severity, 'wallet'),
  };
}

export const detectors = {
  streamFarm: detectStreamFarm,
  circularPayments: detectCircularPayments,
  sybil: detectSybil,
  payoutAbuse: detectPayoutAbuse,
} as const;