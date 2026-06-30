/**
 * Phase 9 — wallet:reconcile worker.
 *
 * Runs on a recurring schedule (every 5 min by default). For each wallet:
 *   1. Fetch the canonical balance from Circle.
 *   2. Compare with the cached Wallet.balanceUsdc.
 *   3. If drift > 0.0001 USDC, log a WalletDrift event AND persist the
 *      authoritative Circle balance.
 *   4. Surface drift counts into AgentHealthMetrics / custom counters.
 *
 * Drift comes from either:
 *   - missed indexer ticks (we cache stale state)
 *   - direct chain activity that bypassed our local indexer
 *   - rare edge case where a transaction was forgotten
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES, enqueue } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger } from '@pazzera/core';
import { getActiveProvider } from '@pazzera/blockchain';

// Drift counts (in-memory) — exported for the /api/admin/payments-health
// endpoint to merge with the Postgres-side counters.
export const driftCounters = {
  lastRunAt: 0,
  driftDetected: 0,
  driftRepaired: 0,
  walletsChecked: 0,
};

const DRIFT_THRESHOLD_USDC = '0.0001';

function usdcGreaterThan(a: string, b: string): boolean {
  const aUnits = BigInt(Math.round(Number.parseFloat(a) * 1_000_000));
  const bUnits = BigInt(Math.round(Number.parseFloat(b) * 1_000_000));
  return aUnits > bUnits;
}

function usdcDiffUsdc(a: string, b: string): string {
  const aUnits = BigInt(Math.round(Number.parseFloat(a) * 1_000_000));
  const bUnits = BigInt(Math.round(Number.parseFloat(b) * 1_000_000));
  const diff = aUnits > bUnits ? aUnits - bUnits : bUnits - aUnits;
  const whole = diff / 1_000_000n;
  const frac = diff % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return (fracStr.length === 0 ? whole.toString() : `${whole}.${fracStr}`);
}

export async function runWalletReconcileWorker() {
  const worker = new Worker(
    'wallet:reconcile',
    async (job: Job) => {
      logger.info({ jobId: job.id }, 'wallet_reconcile:start');
      const provider = getActiveProvider();
      driftCounters.lastRunAt = Date.now();
      const wallets = await prisma.wallet.findMany({
        where: { status: 'active' },
        take: 200,
      });
      for (const w of wallets) {
        driftCounters.walletsChecked += 1;
        try {
          const fetched = w.providerWalletId
            ? await provider.fetchBalance(w.providerWalletId)
            : await provider.fetchBalance(w.address);
          const drift = usdcDiffUsdc(fetched.balanceUsdc, w.balanceUsdc);
          if (usdcGreaterThan(drift, DRIFT_THRESHOLD_USDC)) {
            driftCounters.driftDetected += 1;
            logger.warn(
              { walletId: w.id, cached: w.balanceUsdc, circle: fetched.balanceUsdc, drift },
              'wallet_reconcile:drift',
            );
            await prisma.paymentEvent.create({
              data: {
                kind: 'balance_drift',
                severity: 25,
                meta: {
                  walletId: w.id,
                  cachedBalance: w.balanceUsdc,
                  circleBalance: fetched.balanceUsdc,
                  driftUsdc: drift,
                  blockNumber: fetched.blockNumber,
                },
              },
            }).catch(() => undefined);
            // Auto-repair: persist the canonical Circle balance.
            await prisma.wallet.update({
              where: { id: w.id },
              data: {
                balanceUsdc: fetched.balanceUsdc,
                lastIndexedBlock: BigInt(fetched.blockNumber),
              },
            });
            driftCounters.driftRepaired += 1;
          }
        } catch (err) {
          logger.warn({ err, walletId: w.id }, 'wallet_reconcile:fetch_failed');
        }
      }
      logger.info({ checked: driftCounters.walletsChecked, drift: driftCounters.driftDetected }, 'wallet_reconcile:done');
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'wallet_reconcile:failed'));
  return worker;
}
