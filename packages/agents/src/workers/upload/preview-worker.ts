import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { runPreviewStep } from '@pazzera/upload/pipeline';
import { logger } from '@pazzera/core';

export async function runPreviewWorker() {
  const worker = new Worker(
    QUEUE_NAMES.uploadGeneratePreview,
    async (job: Job) => {
      const { songId, sourceKey } = job.data as { songId: string; sourceKey: string };
      logger.info({ songId, jobId: job.id }, 'upload:preview:start');
      await runPreviewStep(songId, sourceKey);
      logger.info({ songId, jobId: job.id }, 'upload:preview:done');
    },
    { connection: getQueueConnection(), concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'upload:preview:failed');
  });
  return worker;
}