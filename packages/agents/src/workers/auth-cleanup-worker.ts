/**
 * Auth cleanup worker — runs scheduled jobs that:
 *   - Hard-delete consumed/invalidated OTPs older than 24h
 *   - Hard-delete AuthEvent rows older than 30 days
 *   - Hard-delete revoked sessions older than 7 days
 *
 * Keeps the auth-related tables small and predictable.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger } from '@pazzera/core';

export async function runAuthCleanupWorker() {
  const worker = new Worker(
    QUEUE_NAMES.authCleanup,
    async (job: Job) => {
      const { task } = job.data as { task: string };
      const now = new Date();
      if (task === 'expire_otps') {
        const r = await prisma.otpCode.deleteMany({
          where: {
            OR: [
              { consumedAt: { not: null, lt: new Date(now.getTime() - 24 * 3600 * 1000) } },
              { invalidated: true, createdAt: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } },
            ],
          },
        });
        logger.info({ task, deleted: r.count }, 'auth_cleanup:done');
        return { deleted: r.count };
      }
      if (task === 'expire_sessions') {
        const r = await prisma.session.deleteMany({
          where: {
            revokedAt: { not: null, lt: new Date(now.getTime() - 7 * 24 * 3600 * 1000) },
          },
        });
        logger.info({ task, deleted: r.count }, 'auth_cleanup:done');
        return { deleted: r.count };
      }
      if (task === 'gc_auth_events') {
        const r = await prisma.authEvent.deleteMany({
          where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 3600 * 1000) } },
        });
        logger.info({ task, deleted: r.count }, 'auth_cleanup:done');
        return { deleted: r.count };
      }
      return { skipped: true };
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'auth_cleanup:failed');
  });

  return worker;
}