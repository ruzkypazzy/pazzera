/**
 * Discovery worker — RESERVED.
 *
 * Listens to the `agent:discovery` queue. Logs that an event was received
 * but does no real work yet. This is intentional: the queue exists so the
 * app can fire recommendation/trending/playlist events without a missing
 * queue name causing errors. Replace the body once the recommendation
 * engine ships.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { logger } from '@pazzera/core';
import { decideDiscovery } from '../discovery/decide';

export async function runDiscoveryWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentDiscovery,
    async (job: Job) => {
      const decision = decideDiscovery(job.data);
      logger.info(
        {
          jobId: job.id,
          data: job.data,
          decision,
        },
        'discovery:noop',
      );
      // Future implementation:
      //   - on_stream_complete → enqueue user-feed rebuild
      //   - on_song_publish → index for search + add to global trending counter
      //   - rebuild_for_user → query UserHistory, run collaborative filter, write Recommendations table
      //   - rebuild_global_trending → compute top songs from SongMetrics.streamsLast7d
    },
    { connection: getQueueConnection(), concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'discovery:failed');
  });

  return worker;
}