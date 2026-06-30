/**
 * GET /api/dashboard/listener
 * Returns everything the listener dashboard needs in one call.
 */
import { withApi, prisma, requireSession } from '@pazzera/core';
import { AnalyticsRepo } from '@pazzera/db';

export const GET = withApi(async () => {
  const session = await requireSession();
  const [user, wallet, recent, trending, platform, recommended] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { username: true, displayName: true, isArtist: true },
    }),
    prisma.wallet.findUnique({
      where: { userId: session.userId },
      select: { address: true, balanceUsdc: true },
    }),
    prisma.stream.findMany({
      where: { userId: session.userId },
      orderBy: { startedAt: 'desc' },
      take: 6,
      include: {
        song: {
          select: { id: true, title: true, artistName: true, coverUrl: true, durationSeconds: true },
        },
      },
    }),
    prisma.song.findMany({
      where: { isPublic: true, status: 'published' },
      orderBy: { playCount: 'desc' },
      take: 12,
      select: {
        id: true,
        title: true,
        artistName: true,
        coverUrl: true,
        durationSeconds: true,
        playCount: true,
        publishedPriceUsdc: true,
      },
    }),
    AnalyticsRepo.getPlatformSummary(),
    prisma.song.findMany({
      where: { isPublic: true, status: 'published' },
      orderBy: { publishedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        title: true,
        artistName: true,
        coverUrl: true,
        publishedPriceUsdc: true,
      },
    }),
  ]);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const todayAgg = await prisma.payment.aggregate({
    where: { payerUserId: session.userId, status: { in: ['settled', 'distributed'] }, settledAt: { gte: since24h } },
    _sum: { amountBaseUnits: true },
    _count: { _all: true },
  });

  return new Response(
    JSON.stringify({
      user: user ? { username: user.username, displayName: user.displayName, isArtist: user.isArtist } : null,
      wallet: wallet ? { address: wallet.address, balanceUsdc: wallet.balanceUsdc } : null,
      stats: {
        streamsToday: todayAgg._count._all,
        spentToday: Number((todayAgg._sum.amountBaseUnits ?? 0n).toString()) / 1_000_000,
      },
      recentlyPlayed: recent.map((r) => ({
        id: r.song.id,
        title: r.song.title,
        artist: r.song.artistName,
        coverUrl: r.song.coverUrl,
        durationSec: r.song.durationSeconds,
      })),
      trending: trending.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artistName,
        coverUrl: t.coverUrl,
        durationSec: t.durationSeconds,
        playCount: t.playCount,
        publishedPriceUsdc: t.publishedPriceUsdc,
      })),
      recommended: recommended.map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artistName,
        coverUrl: r.coverUrl,
        publishedPriceUsdc: r.publishedPriceUsdc,
      })),
      platform,
      isArtist: user?.isArtist ?? false,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});