/**
 * GET /api/songs/[id]
 */
import { withApi, prisma, AppError } from '@pazzera/core';
import { sumStrings } from '@pazzera/db/utils/big-arith';

export const GET = withApi(async ({ req }) => {
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  const id = parts[parts.length - 1] ?? '';
  const song = await prisma.song.findUnique({
    where: { id },
    include: {
      recipients: { include: { user: { include: { wallet: true } } } },
    },
  });
  if (!song) throw new AppError('NOT_FOUND', 'Song not found', 404);

  // Last 30d trend
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const streams = await prisma.stream.findMany({
    where: { songId: song.id, startedAt: { gte: since30d } },
    select: { startedAt: true, endedAt: true, charged: true, totalActiveMs: true },
  });
  const byDay = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    byDay.set(d.toISOString().slice(5, 10), 0);
  }
  for (const s of streams) {
    const k = s.startedAt.toISOString().slice(5, 10);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const trend = Array.from(byDay.entries()).map(([date, n]) => ({ date, streams: n }));

  const completed = streams.filter((s) => s.charged).length;
  const completionRate = streams.length > 0 ? completed / streams.length : 0;

  return new Response(
    JSON.stringify({
      song: {
        id: song.id,
        slug: song.slug,
        title: song.title,
        artistName: song.artistName,
        artistUsername: song.artistUsername,
        featuredNames: song.featuredNames,
        producerName: song.producerName,
        description: song.description,
        coverUrl: song.coverUrl,
        audioUrl: song.audioUrl,
        durationSeconds: song.durationSeconds,
        publishedPriceUsdc: song.publishedPriceUsdc,
        playCount: song.playCount,
        totalEarnedUsdc: (
          Number(sumStrings(
            await prisma.payment.findMany({
              where: { songId: song.id, status: { in: ['settled', 'distributed'] } },
              select: { amountBaseUnits: true },
            }),
            'amountBaseUnits',
          )) / 1_000_000
        ).toString(),
        completionRate,
        recipients: song.recipients.map((r) => ({
          username: r.username,
          role: r.role,
          percentageBps: r.splitPercentageBps,
          walletAddress: r.user?.wallet?.address ?? r.externalWalletAddress ?? undefined,
        })),
        trend,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});