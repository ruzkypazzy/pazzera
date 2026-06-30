/**
 * Wallet Provisioning Worker.
 *
 * Runs on the `wallet:provision` queue. Decoupled from auth so the
 * listener can land on their dashboard in <1s even if Circle/Arc is
 * slow or the VPS is under heavy load.
 *
 * Phase 4 behavior: uses WalletService.provision() which selects the
 * active WalletProvider (Circle UCW in prod, LocalDev in dev).
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { logger, getEnv, BlockchainError } from '@pazzera/core';
import { WalletService } from '@pazzera/blockchain';
import { recordAuthEvent } from '@pazzera/core/services/auth-events';

export async function runWalletProvisionWorker() {
  const worker = new Worker(
    QUEUE_NAMES.walletProvision,
    async (job: Job) => {
      const { userId, attempt } = job.data as { userId: string; attempt: number };
      logger.info({ userId, attempt, jobId: job.id }, 'wallet_provision:start');

      try {
        const result = await WalletService.provision(userId);
        await recordAuthEvent({
          type: 'wallet_provisioned',
          userId,
          severity: 0,
          meta: { address: result.address, provider: result.provider, custody: result.custody, attempt },
        });
        logger.info(
          { userId, address: result.address, provider: result.provider },
          'wallet_provision:done',
        );
      } catch (err) {
        logger.error({ userId, err, attempt }, 'wallet_provision:failed');
        if (attempt >= 3) {
          await recordAuthEvent({
            type: 'wallet_provision_recovery_needed',
            userId,
            severity: 40,
            meta: { attempt, err: err instanceof Error ? err.message : String(err) },
          });
        }
        throw new BlockchainError(
          'Wallet provisioning failed',
          { userId, attempt, err: err instanceof Error ? err.message : String(err) },
        );
      }
    },
    { connection: getQueueConnection(), concurrency: 8 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'wallet_provision:job_failed');
  });

  return worker;
}