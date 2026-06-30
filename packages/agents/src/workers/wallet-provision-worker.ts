/**
 * Wallet Provisioning Worker.
 *
 * Runs on the `wallet:provision` queue. Decoupled from auth so the
 * listener can land on their dashboard in <1s even if Circle/Arc is
 * slow or the VPS is under heavy load.
 *
 * Phase 3 behavior:
 *   1. Generate secp256k1 keypair (viem)
 *   2. Encrypt private key with AES-256-GCM (HKDF-derived key from master + userId)
 *   3. Write Wallet row with status='active'
 *   4. Mark signup_complete in analytics
 *
 * Phase 4 will replace step 1–2 with a real Circle W3S-provisioned
 * wallet. This worker already runs at user-creation time, so Phase 4
 * just changes the body — no auth-flow change.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger, getEnv, BlockchainError } from '@pazzera/core';
import { generateWalletKeypair, encryptPrivateKey } from '@pazzera/blockchain/wallet-signer';
import { recordAuthEvent } from '@pazzera/core/services/auth-events';

export async function runWalletProvisionWorker() {
  const worker = new Worker(
    QUEUE_NAMES.walletProvision,
    async (job: Job) => {
      const { userId, attempt } = job.data as { userId: string; attempt: number };
      logger.info({ userId, attempt, jobId: job.id }, 'wallet_provision:start');

      // Idempotency: if wallet already exists for this user, no-op
      const existing = await prisma.wallet.findUnique({ where: { userId } });
      if (existing) {
        logger.info({ userId, status: existing.status }, 'wallet_provision:already_exists');
        return;
      }

      try {
        const env = getEnv();
        const { privateKey, address } = generateWalletKeypair();
        const encrypted = encryptPrivateKey(userId, privateKey);

        await prisma.wallet.create({
          data: {
            userId,
            address,
            encryptedPrivateKey: encrypted,
            status: 'active',
            balanceUsdc: '0',
            pendingUsdc: '0',
            // Indexer starts from chain head
            lastIndexedBlock: 0n,
          },
        });

        // Update user record (audit trail)
        await prisma.user.update({
          where: { id: userId },
          data: { updatedAt: new Date() },
        });

        await recordAuthEvent({
          type: 'wallet_provisioned',
          userId,
          severity: 0,
          meta: { address, attempt },
        });

        logger.info({ userId, address, env: env.NODE_ENV }, 'wallet_provision:done');
      } catch (err) {
        logger.error({ userId, err, attempt }, 'wallet_provision:failed');
        // After 3 attempts, mark for recovery
        if (attempt >= 3) {
          try {
            await prisma.user.update({
              where: { id: userId },
              data: { /* no schema field for 'recovery' on user; logged via AuthEvent */ },
            });
            await recordAuthEvent({
              type: 'wallet_provision_recovery_needed',
              userId,
              severity: 40,
              meta: { attempt, err: err instanceof Error ? err.message : String(err) },
            });
          } catch {
            // user might not exist
          }
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