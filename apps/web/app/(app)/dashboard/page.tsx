import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { ListenerDashboard } from '@/components/dashboard/listener-dashboard';
import { WalletStatusBanner } from '@/components/auth/wallet-status-banner';

export const metadata = { title: 'Home — Pazzera' };

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in');

  // Server-render the initial payload so the client has data on first paint.
  const [user, wallet, recent, trending, recommended, todayAgg] = await Promise.all([
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
      include: { song: { select: { id: true, title: true, artistName: true, coverUrl: true, durationSeconds: true } } },
    }),
    prisma.song.findMany({
      where: { isPublic: true, status: 'published' },
      orderBy: { playCount: 'desc' },
      take: 12,
      select: { id: true, title: true, artistName: true, coverUrl: true, durationSeconds: true, playCount: true, publishedPriceUsdc: true },
    }),
    prisma.song.findMany({
      where: { isPublic: true, status: 'published' },
      orderBy: { publishedAt: 'desc' },
      take: 6,
      select: { id: true, title: true, artistName: true, coverUrl: true, publishedPriceUsdc: true },
    }),
    prisma.payment.aggregate({
      where: { payerUserId: session.userId, status: { in: ['settled', 'distributed'] }, settledAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      _sum: { amountBaseUnits: true },
      _count: { _all: true },
    }),
  ]);

  const initial = {
    user: { username: user!.username, displayName: user!.displayName, isArtist: user!.isArtist },
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
    isArtist: user?.isArtist ?? false,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6 space-y-6">
      <WalletStatusBanner />
      <ListenerDashboard initial={initial} />
    </div>
  );
}