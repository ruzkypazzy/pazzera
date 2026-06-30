/**
 * Curator worker — pulls `agent:curator` jobs, builds the v3 input,
 * calls the pure decision function, persists the verdict on the Song row.
 *
 * Phase 7: persists a full AgentDecisionLog row via `recordDecision()`
 * (idempotent on (agent, inputHash)). Health metrics reported every
 * job to support the admin Agent Status cards.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger } from '@pazzera/core';
import { decideCurator, type CuratorInput } from '../curator/decide';
import { recordDecision } from '../utils/record-decision';
import { AgentHealthTracker } from '../utils/agent-health';

const tracker = new AgentHealthTracker(prisma, 'curator');

export async function runCuratorWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentCurator,
    async (job: Job) => {
      const { songId } = job.data as { songId: string };
      const started = Date.now();
      await tracker.inProgress();
      try {
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
          await tracker.success(Date.now() - started);
          return;
        }
        if (song.status !== 'curator_queued' && song.status !== 'published') {
          logger.info({ songId, status: song.status }, 'curator:already_reviewed');
          await tracker.success(Date.now() - started);
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
          ...song.recipients
            .filter((r: { role: string }) => r.role !== 'primary_artist')
            .map((r: { username: string }) => r.username),
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
          totalSongs: artistHistory.reduce(
            (s: number, r: { _count: { _all: number } }) => s + r._count._all,
            0,
          ),
          approvedSongs:
            artistHistory.find((r: { curatorStatus: string }) => r.curatorStatus === 'approved')
              ?._count._all ?? 0,
          rejectedSongs:
            artistHistory.find((r: { curatorStatus: string }) => r.curatorStatus === 'rejected')
              ?._count._all ?? 0,
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

        // ─── Persist ─────────────────────────────────────────
        await prisma.$transaction([
          prisma.song.update({
            where: { id: song.id },
            data: {
              curatorStatus: decision.decision,
              curatorDecision: decision.decision,
              // Phase 7: explicit v3 fields
              curatorScoreTotal: decision.score,
              curatorScoreMetadata: decision.categoryScores.metadata,
              curatorScoreAudio: decision.categoryScores.audioQuality,
              curatorScoreSpam: decision.categoryScores.spamRisk,
              curatorScoreDuplicate: decision.categoryScores.duplicateRisk,
              curatorScoreMarket: decision.categoryScores.marketability,
              curatorScoreLoudness: decision.categoryScores.loudness,
              curatorScoreArtwork: decision.categoryScores.artwork,
              curatorConfidence: decision.confidenceScore,
              curatorReasons: decision.reasons,
              curatorDecisionPayload: decision.scoreBreakdown as object,
              curatorReviewedAt: new Date(),
              publishedPriceUsdc: decision.suggestedPriceUsdc.toFixed(6),
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
              reason: decision.reasons.join('; '),
              scoreBreakdown: decision.scoreBreakdown as object,
              payloadJson: { input, output: decision } as object,
            },
          }),
        ]);

        // ─── Decision Log (Phase 7) ──────────────────────────
        await recordDecision({
          prisma,
          agent: 'curator',
          subject: { type: 'song', id: song.id },
          input,
          decision: decision.decision,
          confidence: decision.confidenceScore,
          reasons: decision.reasons,
          categoryScores: decision.categoryScores,
          rawInputs: { rawMetrics: decision.rawMetrics, breakdown: decision.scoreBreakdown },
          latencyMs: Date.now() - started,
          crossLinks: { songId: song.id },
        });

        logger.info(
          {
            songId,
            decision: decision.decision,
            score: decision.score,
            price: decision.suggestedPriceUsdc,
            confidence: decision.confidenceScore,
          },
          'curator:done',
        );
        await tracker.success(Date.now() - started);
      } catch (err) {
        logger.error({ err, songId, jobId: job.id }, 'curator:failed');
        await tracker.failure(Date.now() - started);
        throw err;
      }
    },
    { connection: getQueueConnection(), concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'curator:failed');
    void tracker.failure(0);
  });
  return worker;
}