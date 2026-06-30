/**
 * Workers entrypoint — runs all agent workers in one process.
 *
 * In production, this runs as `pnpm worker` under PM2.
 */
import { logger, getEnv } from '@pazzera/core';
import { runCuratorWorker } from './curator-worker';
import { runFanWorker } from './fan-worker';
import { runSplitWorker } from './split-worker';
import { runDiscoveryWorker } from './discovery-worker';
import { runFraudWorker } from './fraud-worker';
import { runAnalyticsRollupWorker } from './analytics-rollup-worker';
import { runWalletProvisionWorker } from './wallet-provision-worker';
import { runAuthCleanupWorker } from './auth-cleanup-worker';
import { runWalletIndexerWorker } from './wallet-indexer-worker';
import { runAudioWorker } from './upload/audio-worker';
import { runWaveformWorker } from './upload/waveform-worker';
import { runPreviewWorker } from './upload/preview-worker';
import { runCoverWorker } from './upload/cover-worker';

async function main() {
  logger.info('workers:starting');
  const curator = await runCuratorWorker();
  const fan = await runFanWorker();
  const split = await runSplitWorker();
  const discovery = await runDiscoveryWorker();
  const fraud = await runFraudWorker();
  const analytics = await runAnalyticsRollupWorker();
  const walletProvision = await runWalletProvisionWorker();
  const walletIndexer = await runWalletIndexerWorker();
  const authCleanup = await runAuthCleanupWorker();
  const uploadAudio = await runAudioWorker();
  const uploadWaveform = await runWaveformWorker();
  const uploadPreview = await runPreviewWorker();
  const uploadCover = await runCoverWorker();
  logger.info('workers:ready');

  // Recurring jobs
  const { getQueue, QUEUE_NAMES } = await import('@pazzera/queue');
  const cleanupQ = getQueue(QUEUE_NAMES.authCleanup);
  await cleanupQ.add('expire_otps', { task: 'expire_otps' }, { repeat: { pattern: '17 * * * *' } });
  await cleanupQ.add('expire_sessions', { task: 'expire_sessions' }, { repeat: { pattern: '37 3 * * *' } });
  await cleanupQ.add('gc_auth_events', { task: 'gc_auth_events' }, { repeat: { pattern: '47 4 * * 0' } });

  // Indexer tick (Phase 4)
  const env = getEnv();
  const indexerQ = getQueue(QUEUE_NAMES.walletIndexer);
  await indexerQ.add(
    'indexer.tick',
    {},
    { repeat: { every: env.INDEXER_INTERVAL_SECONDS * 1000 } },
  );

  // Phase 7 — recurring AI agent jobs
  const fraudQ = getQueue(QUEUE_NAMES.agentFraud);
  await fraudQ.add('fraud.scan', { detector: 'all' }, { repeat: { every: 5 * 60 * 1000 } });
  const analyticsQ = getQueue(QUEUE_NAMES.analyticsRollup);
  await analyticsQ.add('analytics.5min', { task: 'rollup', window: '5min' }, { repeat: { every: 5 * 60 * 1000 } });
  await analyticsQ.add('analytics.hour', { task: 'rollup', window: 'hour' }, { repeat: { pattern: '7 * * * *' } });
  await analyticsQ.add('analytics.day', { task: 'rollup', window: 'day' }, { repeat: { pattern: '23 5 * * *' } });

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'workers:shutting_down');
    await Promise.all([
      curator.close(),
      fan.close(),
      split.close(),
      discovery.close(),
      fraud.close(),
      analytics.close(),
      walletProvision.close(),
      walletIndexer.close(),
      authCleanup.close(),
      uploadAudio.close(),
      uploadWaveform.close(),
      uploadPreview.close(),
      uploadCover.close(),
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