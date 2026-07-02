/**
 * GET /api/dashboard/listener
 * Returns everything the listener dashboard needs in one call.
 */
import { withApi, prisma, requireSession } from '@pazzera/core';
import { AnalyticsRepo, sumStrings } from '@pazzera/db';

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
          select: { id: true, title: true, artistName: true, artistUsername: true, coverUrl: true, audioUrl: true, durationSeconds: true },
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
        artistUsername: true,
        coverUrl: true,
        audioUrl: true,
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
        artistUsername: true,
        coverUrl: true,
        audioUrl: true,
        publishedPriceUsdc: true,
      },
    }),
  ]);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [todayAgg, todayPayments] = await Promise.all([
    prisma.payment.count({
      where: { payerUserId: session.userId, status: { in: ['settled', 'distributed'] }, settledAt: { gte: since24h } },
    }),
    prisma.payment.findMany({
      where: { payerUserId: session.userId, status: { in: ['settled', 'distributed'] }, settledAt: { gte: since24h } },
      select: { amountBaseUnits: true },
    }),
  ]);

  return new Response(
    JSON.stringify({
      user: user ? { username: user.username, displayName: user.displayName, isArtist: user.isArtist } : null,
      wallet: wallet ? { address: wallet.address, balanceUsdc: wallet.balanceUsdc } : null,
      stats: {
        streamsToday: todayAgg,
        spentToday: Number(sumStrings(todayPayments, 'amountBaseUnits')) / 1_000_000,
      },
      recentlyPlayed: recent.map((r) => ({
        id: r.song.id,
        title: r.song.title,
        artist: r.song.artistName,
        artistUsername: r.song.artistUsername,
        coverUrl: r.song.coverUrl,
        audioUrl: r.song.audioUrl,
        durationSec: r.song.durationSeconds,
      })),
      trending: trending.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artistName,
        artistUsername: t.artistUsername,
        coverUrl: t.coverUrl,
        audioUrl: t.audioUrl,
        durationSec: t.durationSeconds,
        playCount: t.playCount,
        publishedPriceUsdc: t.publishedPriceUsdc,
      })),
      recommended: recommended.map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artistName,
        artistUsername: r.artistUsername,
        coverUrl: r.coverUrl,
        audioUrl: r.audioUrl,
        publishedPriceUsdc: r.publishedPriceUsdc,
      })),
      platform,
      isArtist: user?.isArtist ?? false,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});