/**
 * Curator worker — pulls `agent:curator` jobs, builds the input, calls the
 * pure decision function, persists the verdict on the Song row.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger } from '@pazzera/core';
import { decideCurator, type CuratorInput } from '../curator/decide';

export async function runCuratorWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentCurator,
    async (job: Job) => {
      const { songId } = job.data as { songId: string };
      logger.info({ songId, jobId: job.id }, 'curator:start');

      const song = await prisma.song.findUnique({
        where: { id: songId },
        include: {
          artist: { include: { artistProfile: true } },
          artistProfile: true,
          recipients: true,
        },
      });
      if (!song) {
        logger.warn({ songId }, 'curator:song_missing');
        return;
      }
      if (song.curatorStatus !== 'pending') {
        logger.info({ songId, status: song.curatorStatus }, 'curator:already_reviewed');
        return;
      }

      const audioQuality = {
        bitrateKbps: song.audioBitrateKbps ?? 128,
        sampleRateHz: song.audioSampleRateHz ?? 44100,
        channels: song.audioChannels ?? 2,
        peakDb: song.audioPeakDb,
      };

      // Duplicate check (audio hash match across approved songs)
      const duplicate = song.audioHash
        ? await prisma.song.findFirst({
            where: {
              audioHash: song.audioHash,
              id: { not: song.id },
              curatorStatus: 'approved',
            },
            select: { id: true },
          })
        : null;

      // Username resolution: every recipient username must exist
      const usernames = [
        song.artistUsername,
        ...song.recipients.filter((r) => r.role !== 'artist').map((r) => r.username),
      ];
      const resolvedUsers = await prisma.user.findMany({
        where: { username: { in: usernames } },
        select: { username: true },
      });
      const usernamesResolved =
        resolvedUsers.length === new Set(usernames).size;

      // Artist history
      const artistHistory = await prisma.song.groupBy({
        by: ['curatorStatus'],
        where: { artistId: song.artistId },
        _count: { _all: true },
      });
      const totals = {
        totalSongs: artistHistory.reduce((s, r) => s + r._count._all, 0),
        approvedSongs: artistHistory.find((r) => r.curatorStatus === 'approved')?._count._all ?? 0,
        rejectedSongs: artistHistory.find((r) => r.curatorStatus === 'rejected')?._count._all ?? 0,
        flaggedForSpam: 0, // surfaced separately when curator marks it
      };

      const input: CuratorInput = {
        songId: song.id,
        artistRequestedPriceUsdc: Number(song.artistPriceUsdc),
        metadata: {
          title: song.title,
          artistName: song.artistName,
          featuredNames: song.featuredNames,
          producerName: song.producerName,
          description: song.description,
          coverUrl: song.coverUrl,
          audioUrl: song.audioUrl,
          durationSeconds: song.durationSeconds,
        },
        audioQuality,
        artistHistory,
        duplicateOfSongId: duplicate?.id ?? null,
        usernamesResolved,
      };

      const decision = decideCurator(input);

      await prisma.$transaction([
        prisma.song.update({
          where: { id: song.id },
          data: {
            curatorStatus: decision.decision,
            publishedPriceUsdc: decision.publishedPriceUsdc,
            curatorScoreMetadata: decision.metadata.metadataScore,
            curatorScoreAudio: decision.metadata.audioQualityScore,
            curatorScoreSpam: decision.metadata.spamScore,
            curatorReasons: decision.reasons,
            curatorReviewedAt: new Date(),
            // Approve → make public
            isPublic: decision.decision === 'approved',
          },
        }),
        prisma.agentLog.create({
          data: {
            agent: 'curator',
            songId: song.id,
            decision: decision.decision,
            payloadJson: JSON.stringify({ input, output: decision }),
          },
        }),
      ]);

      logger.info(
        {
          songId,
          decision: decision.decision,
          publishedPriceUsdc: decision.publishedPriceUsdc,
        },
        'curator:done',
      );
    },
    { connection: getQueueConnection(), concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'curator:failed');
  });

  return worker;
}