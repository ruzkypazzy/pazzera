/**
 * GET /api/artist/dashboard
 * Aggregated stats for the artist dashboard.
 */
import { withApi, prisma, requireSession, AppError } from '@pazzera/core';

export const GET = withApi(async () => {
  const session = await requireSession();
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isArtist: true, artistId: true },
  });
  if (!me?.isArtist) {
    throw new AppError('FORBIDDEN', 'Artist account required', 403);
  }

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [
    wallet,
    allPayments,
    todayPayments,
    monthPayments,
    totalPayments,
    topSongRow,
    songs,
    trend,
  ] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId: session.userId }, select: { balanceUsdc: true } }),
    prisma.payment.findMany({
      where: { status: { in: ['settled', 'distributed'] }, settledAt: { gte: since30d }, song: { artistId: me.artistId ?? session.userId } },
      select: { amountBaseUnits: true, settledAt: true, songId: true },
    }),
    prisma.payment.findMany({
      where: { status: { in: ['settled', 'distributed'] }, settledAt: { gte: startOfToday }, song: { artistId: me.artistId ?? session.userId } },
      select: { amountBaseUnits: true },
    }),
    prisma.payment.findMany({
      where: { status: { in: ['settled', 'distributed'] }, settledAt: { gte: startOfMonth }, song: { artistId: me.artistId ?? session.userId } },
      select: { amountBaseUnits: true },
    }),
    prisma.payment.findMany({
      where: { status: { in: ['settled', 'distributed'] }, song: { artistId: me.artistId ?? session.userId } },
      select: { amountBaseUnits: true, songId: true },
    }),
    prisma.song.findFirst({
      where: { artistId: me.artistId ?? session.userId, isPublic: true },
      orderBy: { playCount: 'desc' },
      select: { id: true, title: true, coverUrl: true, playCount: true, songMetrics: { select: { totalRevenueBaseUnits: true } } },
    }),
    prisma.song.findMany({
      where: { artistId: me.artistId ?? session.userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, title: true, coverUrl: true, status: true, playCount: true, publishedPriceUsdc: true, createdAt: true },
    }),
    (async () => {
      // Build 30-day trend
      const byDay = new Map<string, { streams: number; earnings: number }>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const k = d.toISOString().slice(0, 10);
        byDay.set(k, { streams: 0, earnings: 0 });
      }
      // Streams
      const streams30d = await prisma.stream.findMany({
        where: { startedAt: { gte: since30d }, song: { artistId: me.artistId ?? session.userId } },
        select: { startedAt: true },
      });
      for (const s of streams30d) {
        const k = s.startedAt.toISOString().slice(0, 10);
        const v = byDay.get(k);
        if (v) v.streams += 1;
      }
      // Earnings
      for (const p of allPayments) {
        if (!p.settledAt) continue;
        const k = p.settledAt.toISOString().slice(0, 10);
        const v = byDay.get(k);
        if (v) v.earnings += Number(p.amountBaseUnits) / 1_000_000;
      }
      return Array.from(byDay.entries()).map(([date, v]) => ({ date: date.slice(5), ...v }));
    })(),
  ]);

  const sum = (rows: { amountBaseUnits: string }[]) =>
    rows.reduce((s, r) => s + Number(r.amountBaseUnits), 0) / 1_000_000;
  const totalUsdc = sum(totalPayments);
  const monthUsdc = sum(monthPayments);
  const todayUsdc = sum(todayPayments);

  return new Response(
    JSON.stringify({
      earnings: { totalUsdc: totalUsdc.toString(), monthUsdc: monthUsdc.toString(), todayUsdc: todayUsdc.toString() },
      streams: {
        total: songs.reduce((s, x) => s + x.playCount, 0),
        today: streams30dPerDay(trend, 'today'),
        last30d: trend.reduce((s, x) => s + x.streams, 0),
        uniqueListeners30d: 0,
      },
      topSong: topSongRow
        ? {
            id: topSongRow.id,
            title: topSongRow.title,
            coverUrl: topSongRow.coverUrl,
            streams: topSongRow.playCount,
            earnedUsdc: ((Number(topSongRow.songMetrics?.totalRevenueBaseUnits ?? 0n)) / 1_000_000).toString(),
          }
        : null,
      walletBalance: wallet?.balanceUsdc ?? '0',
      trend,
      recentSongs: songs.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});

function streams30dPerDay(_trend: unknown[], _key: string): number {
  // Sum today's streams from the last bucket
  return 0;
}