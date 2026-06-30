/**
 * Split Agent — pure decision function that reconciles a settled payment
 * against its configured royalty recipients.
 *
 * Phase 7 contract:
 *   - returns SplitDecision with per-recipient amount + status,
 *   - explicit reconciliation block at the bottom for the admin dashboard,
 *   - returns reasons[] that power the AI Explainability card,
 *   - never reaches across process boundaries; given inputs, output
 *     is reproducible (used by integration tests as a golden oracle).
 *
 * Rounding rules:
 *   - USDC has 6 decimals.
 *   - Split amounts are computed by `floor(grossUsdc * bps / 10000)`
 *     to prevent over-allocating the gross.
 *   - Remainder (rounding dust) is added to the recipient with the
 *     lowest payoutPriority (tie-break: most-recent recipient).
 *   - Sum of split amounts must equal grossUsdc to the last decimal.
 *
 * Payout status assignment:
 *   - every recipient gets a tentative 'pending' status
 *   - if upstream tx hashes + statuses are supplied, statuses are
 *     mapped to ('completed' | 'failed' | 'partial_failure')
 *   - at the top level: payment is 'completed' if every recipient
 *     completed, 'partial_failure' if any did, 'failed' if all did.
 */
import type { SplitDecision } from '@pazzera/core';

export interface SplitInput {
  paymentId: string;
  grossAmountUsdc: string;          // string to avoid float drift
  recipients: Array<{
    username: string;
    role: string;
    splitPercentageBps: number;
    payoutPriority: number;
    payoutId?: string;                // set when the worker is reconciling
    txHash?: string | null;
    failureReason?: string | null;
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'partial_failure' | string;
  }>;
}

const USDC_PRECISION = 6;
const BPS_TOTAL = 10_000;

/** Scale to base units (6 decimals) and avoid float drift entirely. */
function usdcToBaseUnits(amount: string | undefined | null): bigint {
  if (amount == null) return 0n;
  if (amount.includes('.')) {
    const [whole, frac = ''] = amount.split('.');
    const padded = (frac + '0'.repeat(USDC_PRECISION)).slice(0, USDC_PRECISION);
    return BigInt(whole) * 10n ** BigInt(USDC_PRECISION) + BigInt(padded);
  }
  return BigInt(amount) * 10n ** BigInt(USDC_PRECISION);
}

function baseUnitsToUsdc(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const factor = 10n ** BigInt(USDC_PRECISION);
  const whole = abs / factor;
  const frac = abs % factor;
  const fracStr = frac.toString().padStart(USDC_PRECISION, '0').replace(/0+$/, '');
  const out = fracStr.length === 0 ? `${whole}` : `${whole}.${fracStr}`;
  return neg ? `-${out}` : out;
}

export function decideSplit(input: SplitInput): SplitDecision {
  const reasons: string[] = [];
  const grossUnits = usdcToBaseUnits(input.grossAmountUsdc);
  const totalBps = input.recipients.reduce((s, r) => s + r.splitPercentageBps, 0);
  if (totalBps !== BPS_TOTAL) {
    reasons.push(`WARNING: splits sum to ${totalBps} bps (expected ${BPS_TOTAL}); remainder will be returned to primary`);
  }

  // Compute exact base-unit allocation per recipient (no float).
  const allocations = input.recipients.map((r) => {
    const units = (grossUnits * BigInt(r.splitPercentageBps)) / BigInt(BPS_TOTAL);
    return { r, units };
  });
  const allocatedUnits = allocations.reduce((s, a) => s + a.units, 0n);
  let dustUnits = grossUnits - allocatedUnits;
  if (dustUnits < 0n) dustUnits = 0n;
  if (dustUnits > 0n) reasons.push(`Rounding dust: ${baseUnitsToUsdc(dustUnits)} USDC credited to highest-priority recipient`);

  // Distribute dust: lowest payoutPriority wins; tie-break = last index.
  let dustRecipientIdx = -1;
  if (dustUnits > 0n && allocations.length > 0) {
    let bestPriority = Infinity;
    for (let i = 0; i < allocations.length; i++) {
      const p = allocations[i]!.r.payoutPriority;
      if (p <= bestPriority) {
        bestPriority = p;
        dustRecipientIdx = i;
      }
    }
  }

  // Map each allocation → SplitDecision split row
  const splits = allocations.map((a, i) => {
    let units = a.units;
    if (i === dustRecipientIdx) units += dustUnits;
    const rawStatus = (a.r.status ?? 'pending') as 'pending' | 'processing' | 'completed' | 'failed' | 'partial_failure';
    const status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial_failure' =
      ['completed', 'failed', 'processing', 'partial_failure'].includes(rawStatus)
        ? rawStatus
        : 'pending';
    return {
      username: a.r.username,
      role: a.r.role,
      splitPercentageBps: a.r.splitPercentageBps,
      amountUsdc: baseUnitsToUsdc(units),
      payoutStatus: status,
      payoutId: a.r.payoutId,
      txHash: a.r.txHash ?? null,
      failureReason: a.r.failureReason ?? null,
    };
  });

  // Top-level reconciliation
  const completed = splits.filter((s) => s.payoutStatus === 'completed').length;
  const failed = splits.filter((s) => s.payoutStatus === 'failed').length;
  const attempted = splits.filter((s) => s.payoutStatus === 'pending' || s.payoutStatus === 'processing' || s.payoutStatus === 'completed' || s.payoutStatus === 'failed').length;

  let topStatus: SplitDecision['payoutStatus'];
  if (failed === splits.length) {
    topStatus = 'failed';
  } else if (failed > 0) {
    topStatus = 'partial_failure';
    reasons.push(`${failed} of ${splits.length} payouts failed`);
  } else if (completed === splits.length) {
    topStatus = 'completed';
  } else {
    topStatus = 'processing';
  }

  const settledUnits = splits
    .filter((s) => s.payoutStatus === 'completed')
    .reduce((sum, s) => sum + usdcToBaseUnits(s.amountUsdc), 0n);
  const pendingUnits = splits
    .filter((s) => s.payoutStatus !== 'completed' && s.payoutStatus !== 'failed')
    .reduce((sum, s) => sum + usdcToBaseUnits(s.amountUsdc), 0n);

  return {
    totalAmountUsdc: input.grossAmountUsdc,
    splits,
    payoutStatus: topStatus,
    reconciliation: {
      splitsAttempted: attempted,
      splitsCompleted: completed,
      splitsFailed: failed,
      amountSettled: baseUnitsToUsdc(settledUnits),
      amountPending: baseUnitsToUsdc(pendingUnits),
    },
    reasons: reasons.length ? reasons : [`Reconciled ${splits.length} recipient(s) cleanly`],
  };
}