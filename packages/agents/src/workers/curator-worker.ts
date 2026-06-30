/**
 * Curator worker — pulls `agent:curator` jobs, builds the v3 input,
 * calls the pure decision function, persists the verdict on the Song row.
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
          artist: { select: { id: true, isArtist: true, createdAt: true } },
          recipients: true,
        },
      });
      if (!song) {
        logger.warn({ songId }, 'curator:song_missing');
        return;
      }
      if (song.status !== 'curator_queued' && song.status !== 'published') {
        logger.info({ songId, status: song.status }, 'curator:already_reviewed');
        return;
      }

      // Audio metadata
      const audioQuality = {
        bitrateKbps: song.audioBitrateKbps ?? 128,
        sampleRateHz: song.audioSampleRateHz ?? 44100,
        channels: song.audioChannels ?? 2,
        peakDb: song.audioPeakDb ?? -3,
        codec: song.audioCodec ?? undefined,
        containerFormat: song.audioContainer ?? undefined,
        lufsIntegrated: song.audioLufsIntegrated ?? null,
        lufsRange: song.audioLufsRange ?? null,
        truePeakDb: song.audioTruePeakDb ?? null,
      };

      // Binary duplicate (exact match)
      const binaryDup = song.audioHash
        ? await prisma.song.findFirst({
            where: { audioHash: song.audioHash, id: { not: song.id }, curatorStatus: 'approved' },
            select: { id: true },
          })
        : null;
      // Acoustic duplicate (content-based)
      const acousticDup = song.acousticHash
        ? await prisma.song.findFirst({
            where: { acousticHash: song.acousticHash, id: { not: song.id }, curatorStatus: 'approved' },
            select: { id: true },
          })
        : null;

      // Username resolution
      const usernames = [
        song.artistUsername,
        ...song.recipients.filter((r) => r.role !== 'primary_artist').map((r) => r.username),
      ];
      const resolvedUsers = await prisma.user.findMany({
        where: { username: { in: usernames } },
        select: { username: true },
      });
      const usernamesResolved = resolvedUsers.length === new Set(usernames).size;

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
        flaggedForSpam: 0,
      };

      // Recipients + artwork
      const recipientCount = song.recipients.length;
      const artwork = {
        widthPx: song.coverWidthPx ?? 0,
        heightPx: song.coverHeightPx ?? 0,
        isSquare: song.coverIsSquare ?? false,
        aspectRatio: song.coverAspectRatio ?? 1,
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
        artistHistory: totals,
        duplicate: {
          binaryHashMatch: !!binaryDup,
          acousticHashMatch: !!acousticDup,
        },
        usernamesResolved,
        recipientCount,
        artwork,
      };

      const decision = decideCurator(input);

      await prisma.$transaction([
        prisma.song.update({
          where: { id: song.id },
          data: {
            curatorStatus: decision.decision,
            // Use the v3 normalized score (0–100) as the persisted score
            curatorScoreTotal: decision.scores.normalized,
            curatorScoreMetadata: decision.scores.metadata,
            curatorScoreAudio: decision.scores.audio,
            curatorScoreSpam: decision.scores.spam,
            curatorScoreDuplicate: decision.scores.duplicate,
            curatorScoreMarket: decision.scores.market,
            curatorReasons: decision.reasons,
            curatorReviewedAt: new Date(),
            publishedPriceUsdc: decision.publishedPriceUsdc,
            // Auto-publish on approval
            status: decision.decision === 'approved' ? 'published' : decision.decision,
            isPublic: decision.decision === 'approved',
            publishedAt: decision.decision === 'approved' ? new Date() : null,
          },
        }),
        prisma.agentLog.create({
          data: {
            agent: 'curator',
            songId: song.id,
            decision: decision.decision,
            payloadJson: JSON.stringify({ input, output: decision, scores: decision.scores }),
          },
        }),
      ]);

      logger.info(
        {
          songId,
          decision: decision.decision,
          score: decision.scores.normalized,
          price: decision.publishedPriceUsdc,
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