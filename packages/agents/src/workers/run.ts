/**
 * Workers entrypoint — runs all agent workers in one process.
 *
 * In production, this runs as `pnpm worker` under PM2.
 */
import { logger } from '@pazzera/core';
import { runCuratorWorker } from './curator-worker';
import { runFanWorker } from './fan-worker';
import { runSplitWorker } from './split-worker';
import { runDiscoveryWorker } from './discovery-worker';
import { runWalletProvisionWorker } from './wallet-provision-worker';
import { runAuthCleanupWorker } from './auth-cleanup-worker';
import { enqueue } from '@pazzera/queue';

async function main() {
  logger.info('workers:starting');
  const curator = await runCuratorWorker();
  const fan = await runFanWorker();
  const split = await runSplitWorker();
  const discovery = await runDiscoveryWorker();
  const walletProvision = await runWalletProvisionWorker();
  const authCleanup = await runAuthCleanupWorker();
  logger.info('workers:ready');

  // Register recurring auth cleanup jobs (one per day, 1 hour apart).
  // Repeatable jobs in BullMQ — only one instance ever exists in the queue.
  const { getQueue } = await import('@pazzera/queue');
  const q = getQueue('auth:cleanup' as never);
  await q.add(
    'expire_otps',
    { task: 'expire_otps' },
    { repeat: { pattern: '17 * * * *' } }, // top of every hour
  );
  await q.add(
    'expire_sessions',
    { task: 'expire_sessions' },
    { repeat: { pattern: '37 3 * * *' } }, // 03:37 daily
  );
  await q.add(
    'gc_auth_events',
    { task: 'gc_auth_events' },
    { repeat: { pattern: '47 4 * * 0' } }, // Sunday 04:47
  );

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'workers:shutting_down');
    await Promise.all([
      curator.close(),
      fan.close(),
      split.close(),
      discovery.close(),
      walletProvision.close(),
      authCleanup.close(),
    ]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'workers:fatal');
  process.exit(1);
});