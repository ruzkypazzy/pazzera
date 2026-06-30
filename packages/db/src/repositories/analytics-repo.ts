/**
 * Analytics repository.
 *
 * Read paths are straightforward Prisma finds. Write paths are called
 * by the rollup worker (Phase 7) every 5 min for sliding windows and
 * once per day for DailyMetrics snapshots.
 */
import { prisma } from '../client';
import { sumStrings } from '../utils/big-arith';

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
    // Aggregate: streams today, total earnings, DAU last 24h.
    // `amountBaseUnits` is a `String!` column on Payment — Prisma 5.22
    // doesn't allow it in `_sum` typed inputs, so we sum in memory via
    // the shared `sumStrings` helper.
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [streams, dau, earningsRows] = await Promise.all([
      prisma.stream.count({ where: { startedAt: { gte: since24h } } }),
      prisma.stream.findMany({
        where: { startedAt: { gte: since24h } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prisma.payment.findMany({
        where: { status: { in: ['settled', 'distributed'] } },
        select: { amountBaseUnits: true },
      }),
    ]);
    return {
      streamsLast24h: streams,
      dauLast24h: dau.length,
      totalEarningsBaseUnits: sumStrings(earningsRows, 'amountBaseUnits').toString(),
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
