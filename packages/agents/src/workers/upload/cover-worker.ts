import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { runCoverStep } from '@pazzera/upload/pipeline';
import { logger } from '@pazzera/core';

export async function runCoverWorker() {
  const worker = new Worker(
    QUEUE_NAMES.uploadProcessCover,
    async (job: Job) => {
      const { songId } = job.data as { songId: string };
      logger.info({ songId, jobId: job.id }, 'upload:cover:start');
      await runCoverStep(songId);
      logger.info({ songId, jobId: job.id }, 'upload:cover:done');
    },
    { connection: getQueueConnection(), concurrency: 4 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'upload:cover:failed');
  });
  return worker;
}