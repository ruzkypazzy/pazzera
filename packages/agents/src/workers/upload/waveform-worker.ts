import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { runWaveformStep } from '@pazzera/upload/pipeline';
import { logger } from '@pazzera/core';

export async function runWaveformWorker() {
  const worker = new Worker(
    QUEUE_NAMES.uploadGenerateWaveform,
    async (job: Job) => {
      const { songId, sourceKey } = job.data as { songId: string; sourceKey: string };
      logger.info({ songId, jobId: job.id }, 'upload:waveform:start');
      await runWaveformStep(songId, sourceKey);
      logger.info({ songId, jobId: job.id }, 'upload:waveform:done');
    },
    { connection: getQueueConnection(), concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'upload:waveform:failed');
  });
  return worker;
}