/**
 * Workers entrypoint — runs all agent workers in one process.
 *
 * In production, this runs as `pnpm worker` under PM2.
 */
import { logger } from '@pazzera/core';
import { runCuratorWorker } from './curator-worker';
import { runFanWorker } from './fan-worker';
import { runSplitWorker } from './split-worker';

async function main() {
  logger.info('workers:starting');
  const curator = await runCuratorWorker();
  const fan = await runFanWorker();
  const split = await runSplitWorker();
  logger.info('workers:ready');

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'workers:shutting_down');
    await Promise.all([curator.close(), fan.close(), split.close()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'workers:fatal');
  process.exit(1);
});