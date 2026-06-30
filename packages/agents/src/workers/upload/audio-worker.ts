/**
 * Upload audio worker.
 * Pulls from `upload:process-audio` queue, runs the metadata + fingerprint
 * step, fans out to waveform/preview/cover.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES, enqueue } from '@pazzera/queue';
import { runAudioStep } from '@pazzera/upload/pipeline';
import { logger } from '@pazzera/core';

export async function runAudioWorker() {
  const worker = new Worker(
    QUEUE_NAMES.uploadProcessAudio,
    async (job: Job) => {
      const { songId, sourceKey } = job.data as { songId: string; sourceKey: string };
      logger.info({ songId, jobId: job.id }, 'upload:audio:start');
      await runAudioStep(songId, sourceKey);
      logger.info({ songId, jobId: job.id }, 'upload:audio:done');
    },
    { connection: getQueueConnection(), concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'upload:audio:failed');
  });
  return worker;
}