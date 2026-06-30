/**
 * Analytics rollup worker — materializes Platform / Song / Artist
 * metrics into DailyMetrics, SongMetrics, ArtistMetrics.
 *
 * Phase 7 contract:
 *   - Idempotent: re-running the same window produces the same upserts.
 *   - Deterministic: pure SQL aggregations + manual String-field sums.
 *
 * Note: Prisma 5.22's typed-aggregate input surface doesn't expose String
 * fields (only numeric + boolean), so we fetch the rows and reduce in JS
 * for amountUsdc / amountBaseUnits. For a million-row table this would
 * be a SQL aggregation; for our scale it's fine.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger } from '@pazzera/core';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfHour(d: Date): Date {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x;
}
function startOfWindow5min(d: Date): Date {
  const ms = d.getTime();
  const bucket = Math.floor(ms / (5 * 60_000)) * 5 * 60_000;
  return new Date(bucket);
}

/** Sum a list of decimal strings into a single decimal string (BigInt math). */
function sumStrings(rows: Array<{ amountUsdc?: string; amountBaseUnits?: string }>, key: 'amountUsdc' | 'amountBaseUnits'): string {
  let total = 0n;
  for (const r of rows) {
    const v = r[key];
    if (!v) continue;
    total += BigInt(v);
  }
  return total.toString();
}

async function rollupPlatformDaily(now: Date): Promise<void> {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayStart = startOfDay(yesterday);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const [streams, users, listeners, flagged, manualReviews, settledPayments] = await Promise.all([
    prisma.stream.count({ where: { startedAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.user.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.stream.findMany({
      where: { startedAt: { gte: dayStart, lt: dayEnd } },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.stream.count({ where: { startedAt: { gte: dayStart, lt: dayEnd }, flaggedAbuse: true } }),
    prisma.manualReview.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.payment.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd }, status: { in: ['settled', 'distributed'] } },
      select: { amountBaseUnits: true, amountUsdc: true },
    }),
  ]);

  const revenueBaseUnits = sumStrings(settledPayments, 'amountBaseUnits');
  const revenueUsdc = sumStrings(settledPayments, 'amountUsdc');

  await prisma.dailyMetrics.upsert({
    where: { date: dayStart },
    create: {
      date: dayStart,
      newUsers: users,
      totalStreams: streams,
      uniqueListeners: listeners.length,
      revenueBaseUnits,
      revenueUsdc,
      flaggedStreams: flagged,
      manualReviewCount: manualReviews,
    },
    update: {
      totalStreams: streams,
      uniqueListeners: listeners.length,
      newUsers: users,
      revenueBaseUnits,
      revenueUsdc,
      flaggedStreams: flagged,
      manualReviewCount: manualReviews,
    },
  });
}

async function rollupSongMetrics(): Promise<number> {
  const songs = await prisma.song.findMany({ where: { status: 'published' }, select: { id: true, playCount: true, uniqueListenerCount: true } });
  let updated = 0;
  for (const s of songs) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [streams7d, payments7d, completed, totalRecent, last] = await Promise.all([
      prisma.stream.count({ where: { songId: s.id, startedAt: { gte: since } } }),
      prisma.payment.findMany({
        where: { songId: s.id, status: { in: ['settled', 'distributed'] }, createdAt: { gte: since } },
        select: { amountUsdc: true, amountBaseUnits: true },
      }),
      prisma.stream.count({ where: { songId: s.id, totalActiveMs: { gte: 25_000 } } }),
      prisma.stream.count({ where: { songId: s.id } }),
      prisma.stream.findFirst({ where: { songId: s.id }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    ]);
    const completionRate = totalRecent === 0 ? 0 : completed / totalRecent;
    const revenue7dBaseUnits = sumStrings(payments7d, 'amountBaseUnits');
    const revenue7dUsdc = sumStrings(payments7d, 'amountUsdc');
    await prisma.songMetrics.upsert({
      where: { songId: s.id },
      create: {
        songId: s.id,
        streamCount: s.playCount,
        uniqueListenerCount: s.uniqueListenerCount,
        completionRate,
        totalRevenueUsdc: '0',
        totalRevenueBaseUnits: revenue7dBaseUnits,
        streamsLast7d: streams7d,
        revenueLast7dUsdc: revenue7dUsdc,
        lastStreamAt: last?.startedAt ?? null,
      },
      update: {
        completionRate,
        totalRevenueBaseUnits: revenue7dBaseUnits,
        streamsLast7d: streams7d,
        revenueLast7dUsdc: revenue7dUsdc,
        lastStreamAt: last?.startedAt ?? null,
      },
    });
    updated += 1;
  }
  return updated;
}

async function rollupArtistMetrics(): Promise<number> {
  const artists = await prisma.user.findMany({ where: { isArtist: true }, select: { id: true } });
  let updated = 0;
  for (const a of artists) {
    const [songs, published, payouts7d, payoutsLifetime, streams30d, uniqueListeners30d, last] = await Promise.all([
      prisma.song.count({ where: { artistId: a.id } }),
      prisma.song.count({ where: { artistId: a.id, status: 'published' } }),
      prisma.payout.findMany({
        where: { recipientUserId: a.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        select: { amountUsdc: true, amountBaseUnits: true },
      }),
      prisma.payout.findMany({
        where: { recipientUserId: a.id },
        select: { amountUsdc: true, amountBaseUnits: true },
      }),
      prisma.stream.count({
        where: { song: { artistId: a.id }, startedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      }),
      prisma.stream.findMany({
        where: { song: { artistId: a.id }, startedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      prisma.stream.findFirst({
        where: { song: { artistId: a.id } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      }),
    ]);
    const monthlyEarningsUsdc = sumStrings(payouts7d, 'amountUsdc');
    const totalEarningsUsdc = sumStrings(payoutsLifetime, 'amountUsdc');
    const totalEarningsBaseUnits = sumStrings(payoutsLifetime, 'amountBaseUnits');
    await prisma.artistMetrics.upsert({
      where: { artistId: a.id },
      create: {
        artistId: a.id,
        songCount: songs,
        publishedSongCount: published,
        monthlyEarningsUsdc,
        totalEarningsUsdc,
        totalEarningsBaseUnits,
        streamsLast30d: streams30d,
        activeListeners30d: uniqueListeners30d.length,
        uniqueListeners30d: uniqueListeners30d.length,
        lastStreamAt: last?.startedAt ?? null,
      },
      update: {
        songCount: songs,
        publishedSongCount: published,
        monthlyEarningsUsdc,
        totalEarningsUsdc,
        totalEarningsBaseUnits,
        streamsLast30d: streams30d,
        activeListeners30d: uniqueListeners30d.length,
        uniqueListeners30d: uniqueListeners30d.length,
        lastStreamAt: last?.startedAt ?? null,
      },
    });
    updated += 1;
  }
  return updated;
}

async function rollupPlatformRealtime(now: Date): Promise<{
  dau: number;
  streams5m: number;
  revenue5mUsdc: string;
  uniqueArtists: number;
  flagged5m: number;
}> {
  const since = startOfWindow5min(now);
  const [listeners, streams, payments, artists, flagged] = await Promise.all([
    prisma.stream.findMany({
      where: { startedAt: { gte: since } },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.stream.count({ where: { startedAt: { gte: since } } }),
    prisma.payment.findMany({
      where: { createdAt: { gte: since } },
      select: { amountUsdc: true },
    }),
    prisma.stream.findMany({
      where: { startedAt: { gte: since } },
      select: { song: { select: { artistId: true } } },
      distinct: ['songId'],
    }),
    prisma.stream.count({ where: { startedAt: { gte: since }, flaggedAbuse: true } }),
  ]);
  const artistIds = new Set<string>(artists.map((a: { song: { artistId: string } }) => a.song.artistId));
  return {
    dau: listeners.length,
    streams5m: streams,
    revenue5mUsdc: sumStrings(payments, 'amountUsdc'),
    uniqueArtists: artistIds.size,
    flagged5m: flagged,
  };
}

export async function runAnalyticsRollupWorker() {
  const worker = new Worker(
    QUEUE_NAMES.analyticsRollup,
    async (job: Job) => {
      try {
        const window = (job.data as { window: '5min' | 'hour' | 'day' }).window ?? '5min';
        const now = new Date();
        let songs = 0, artists = 0;
        if (window === '5min') {
          await rollupPlatformRealtime(now);
        } else if (window === 'hour') {
          songs = await rollupSongMetrics();
          artists = await rollupArtistMetrics();
        } else {
          await rollupPlatformDaily(now);
          songs = await rollupSongMetrics();
          artists = await rollupArtistMetrics();
        }
        logger.info({ window, songs, artists }, 'analytics:done');
      } catch (err) {
        logger.error({ err, jobId: job.id }, 'analytics:failed');
        throw err;
      }
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'analytics:failed'));
  return worker;
}
