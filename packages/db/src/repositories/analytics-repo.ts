/**
 * Analytics repository.
 *
 * Read paths are straightforward Prisma finds. Write paths are called
 * by the rollup worker (Phase 7) every 5 min for sliding windows and
 * once per day for DailyMetrics snapshots.
 */
import { prisma } from '../client';
import { getEnv } from '@pazzera/core';

export const AnalyticsRepo = {
  async getDailyMetrics(date: Date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return prisma.dailyMetrics.findUnique({ where: { date: d } });
  },
  async getSongMetrics(songId: string) {
    return prisma.songMetrics.findUnique({ where: { songId } });
  },
  async getArtistMetrics(artistId: string) {
    return prisma.artistMetrics.findUnique({ where: { artistId } });
  },
  async getPlatformSummary() {
    const env = (() => {
      try { return getEnv(); } catch { return null; }
    })();
    void env;
    // Aggregate: streams today, total earnings, DAU last 24h
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [streams, dau, earnings] = await Promise.all([
      prisma.stream.count({ where: { startedAt: { gte: since24h } } }),
      prisma.stream.findMany({
        where: { startedAt: { gte: since24h } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prisma.payment.aggregate({
        where: { status: { in: ['settled', 'distributed'] } },
        _sum: { amountBaseUnits: true },
      }),
    ]);
    return {
      streamsLast24h: streams,
      dauLast24h: dau.length,
      totalEarningsBaseUnits: earnings._sum.amountBaseUnits?.toString() ?? '0',
    };
  },
  async topSongsLast7d(limit = 20) {
    return prisma.songMetrics.findMany({
      orderBy: { streamsLast7d: 'desc' },
      take: limit,
      include: {
        song: { select: { title: true, slug: true, artistName: true, coverUrl: true } },
      },
    });
  },
  async topArtistsLast30d(limit = 20) {
    return prisma.artistMetrics.findMany({
      orderBy: { streamsLast30d: 'desc' },
      take: limit,
      include: {
        artist: { select: { username: true, displayName: true, avatarUrl: true } },
      },
    });
  },
};