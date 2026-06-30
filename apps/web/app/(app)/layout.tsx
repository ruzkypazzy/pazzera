import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/topbar';
import { StickyPlayer } from '@/components/player/sticky-player';
import { PaymentToastHost } from '@/components/realtime/payment-toast-host';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in');

  const [user, wallet, isAdmin] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { username: true, displayName: true, avatarUrl: true, isArtist: true, role: true },
    }),
    prisma.wallet.findUnique({
      where: { userId: session.userId },
      select: { address: true, balanceUsdc: true },
    }),
    (async () => {
      const { UserRepo } = await import('@pazzera/db/repositories');
      return UserRepo.isAdmin(session.userId);
    })(),
  ]);

  if (!user) redirect('/sign-in');

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar isArtist={user.isArtist} isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          user={user}
          wallet={wallet}
        />
        <main className="flex-1 overflow-y-auto pb-24 scrollbar-thin">
          {children}
        </main>
      </div>
      <StickyPlayer />
      <PaymentToastHost />
    </div>
  );
}