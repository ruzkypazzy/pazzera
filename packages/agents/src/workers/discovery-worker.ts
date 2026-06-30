/**
 * Discovery worker — materializes personalized recommendation lists
 * per bucket (for_you, trending, rising_artists, because_you_listened)
 * for every recently-active user.
 *
 * Pipeline:
 *   1. Find recently-active users (last 7d streams).
 *   2. For each user, fetch candidate songs:
 *      - songs from artists they've listened to (artist similarity)
 *      - songs from collaborative-filtering similar users
 *      - all trending songs (last 7d)
 *   3. For each candidate, build the discovery input and run the pure
 *      decideDiscovery function.
 *   4. Bucket + cache to Redis: `pazzera:recs:{bucket}:{userId}`.
 *
 * Phase 7: AgentDecisionLog persisted per recommendation for the
 * admin AI Explainability panel.
 */
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger } from '@pazzera/core';
import { decideDiscovery, type DiscoveryInput } from '../discovery/decide';
import { recordDecision } from '../utils/record-decision';
import { AgentHealthTracker } from '../utils/agent-health';
import { env } from '@pazzera/core/config/env';

const tracker = new AgentHealthTracker(prisma, 'discovery');

const CACHE_TTL_SECONDS = 6 * 3600;

function getRedis(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
}

async function userSignals(userId: string): Promise<{
  recentListenTitles: string[];
  similarSongTitle: string | null;
  walletSpendAffinity: number;
  replayCount: number;
  completionRate: number;
  cfSimilarity: number;
  recentSimilarListen: number;
}> {
  const last30d = new Date(Date.now() - 30 * 86400_000);
  const streams = await prisma.stream.findMany({
    where: { userId, startedAt: { gte: last30d }, totalActiveMs: { gt: 0 } },
    select: {
      totalActiveMs: true,
      song: { select: { id: true, durationSeconds: true, genres: true, title: true, artistId: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: 200,
  });
  const totalListenSec = streams.reduce((s, r) => s + r.totalActiveMs / 1000, 0);
  const completedCount = streams.filter((r) => r.totalActiveMs / 1000 >= r.song.durationSeconds * 0.25).length;
  const completionRate = streams.length === 0 ? 0 : completedCount / streams.length;

  const recentSimilarListen = streams.length === 0 ? 0 : Math.min(1, streams.length / 30);
  const recentListenTitles = streams.slice(0, 5).map((r) => r.song.title);
  const similarSongTitle = streams[0]?.song.title ?? null;

  // Wallet spend affinity — pay per stream is an interest signal.
  // We don't have a payment table here; estimate from total paid streams
  // (charged=true) and average price (estimate 0.003 USDC).
  const chargedStreams = streams.length; // placeholder, real value comes from join
  const walletSpendAffinity = Math.min(1, chargedStreams / 20);

  return {
    recentListenTitles,
    similarSongTitle,
    walletSpendAffinity,
    replayCount: 0,
    completionRate,
    cfSimilarity: 0.5,
    recentSimilarListen,
  };
}

async function candidateSignals(songId: string, songArtistId: string): Promise<{
  artistPublishedCount: number;
  artistTrendingRank: number;
  trendingVelocity: number;
  songCompletionRate: number;
  daysSinceUpload: number;
}> {
  const last7d = new Date(Date.now() - 7 * 86400_000);
  const [songs, song, lifetimeStreamCount, recentStreamCount, totalLifetime] = await Promise.all([
    prisma.song.count({ where: { artistId: songArtistId, status: 'published' } }),
    prisma.song.findUnique({ where: { id: songId }, select: { createdAt: true, playCount: true, uniqueListenerCount: true } }),
    prisma.stream.count({ where: { songId } }),
    prisma.stream.count({ where: { songId, startedAt: { gte: last7d } } }),
    prisma.stream.count(),
  ]);
  const trendingVelocity = totalLifetime === 0 ? 0 : Math.min(1, recentStreamCount / Math.max(1, totalLifetime / 8));
  // Top-trending rank = share of recent traffic vs total
  const trendingShare = recentStreamCount / Math.max(1, totalLifetime / 8);
  const artistTrendingRank = Math.max(0, Math.min(1, 1 - trendingShare));

  const daysSinceUpload = song ? Math.max(0, (Date.now() - song.createdAt.getTime()) / 86400_000) : 30;
  const completed = await prisma.stream.count({ where: { songId, totalActiveMs: { gt: 0 } } });
  const songCompletionRate = lifetimeStreamCount === 0 ? 0 : completed / lifetimeStreamCount;
  return {
    artistPublishedCount: songs,
    artistTrendingRank,
    trendingVelocity,
    songCompletionRate,
    daysSinceUpload,
  };
}

export async function materializeForUser(userId: string, redis: Redis): Promise<void> {
  const user = await userSignals(userId);
  // Cheap candidate set: take 50 recent published songs (the more clever
  // version pre-filters via CF SQL; for Phase 7 we brute-force the cache).
  const candidates = await prisma.song.findMany({
    where: { status: 'published', isPublic: true },
    orderBy: { publishedAt: 'desc' },
    take: 50,
    select: { id: true, artistId: true },
  });

  const recs = await Promise.all(
    candidates.map(async (c) => {
      const cs = await candidateSignals(c.id, c.artistId);
      const input: DiscoveryInput = {
        userId,
        songId: c.id,
        userCfSimilarity: user.cfSimilarity,
        userCompletionRate: user.completionRate,
        userReplayCount: user.replayCount,
        userWalletSpendAffinity: user.walletSpendAffinity,
        artistSimilarity: 0.5,
        trendingVelocity: cs.trendingVelocity,
        daysSinceUpload: cs.daysSinceUpload,
        songCompletionRate: cs.songCompletionRate,
        artistPublishedCount: cs.artistPublishedCount,
        artistTrendingRank: cs.artistTrendingRank,
        recentSimilarListen: user.recentSimilarListen,
        recentSimilarSongTitle: user.similarSongTitle ?? undefined,
      };
      const decided = decideDiscovery(input);
      await recordDecision({
        prisma,
        agent: 'discovery',
        subject: { type: 'user', id: userId },
        input,
        decision: decided.bucket,
        confidence: 70,
        reasons: [decided.explanation],
        categoryScores: decided.signals,
        crossLinks: { songId: c.id, userId },
      });
      return decided;
    }),
  );

  // Group by bucket
  const byBucket: Record<string, Array<{ songId: string; score: number; explanation: string }>> = {
    for_you: [],
    trending: [],
    rising_artists: [],
    because_you_listened: [],
  };
  for (const r of recs.sort((a, b) => b.score - a.score)) {
    byBucket[r.bucket]!.push({ songId: r.songId, score: r.score, explanation: r.explanation });
  }

  await Promise.all(
    (Object.entries(byBucket) as [keyof typeof byBucket, typeof byBucket[keyof typeof byBucket]][]).map(([bucket, list]) =>
      redis.set(`pazzera:recs:${bucket}:${userId}`, JSON.stringify(list.slice(0, 12)), 'EX', CACHE_TTL_SECONDS),
    ),
  );
}

export async function runDiscoveryWorker() {
  const redis = getRedis();
  const worker = new Worker(
    QUEUE_NAMES.agentDiscovery,
    async (job: Job) => {
      const started = Date.now();
      await tracker.inProgress();
      try {
        const { userId } = job.data as { userId: string };
        await materializeForUser(userId, redis);
        await tracker.success(Date.now() - started);
        logger.info({ userId }, 'discovery:done');
      } catch (err) {
        logger.error({ err }, 'discovery:failed');
        await tracker.failure(Date.now() - started);
        throw err;
      }
    },
    { connection: getQueueConnection(), concurrency: 4 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'discovery:failed'));
  return worker;
}