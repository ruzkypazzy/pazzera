import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { PaymentToastHost } from '@/components/realtime/payment-toast-host';
import { PlayerBar } from '@/components/shell/PlayerBar';
import { ShellUserProvider, type ShellUser } from '@/components/shell/ShellUserContext';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in?next=/home');

  // Authoritative session values, fetched once per layout render.
  // Consumed by <AppShell> via ShellUserContext so the avatar dropdown
  // and the header USDC pill always show the real role + balance —
  // regardless of which page the user is on or whether the page
  // forwarded props.
  let shellUser: ShellUser = { isArtist: false, isAdmin: false, walletBalance: '0.00' };
  const [user, wallet] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { isArtist: true, role: true, displayName: true, username: true },
    }),
    prisma.wallet.findUnique({
      where: { userId: session.userId },
      select: { balanceUsdc: true },
    }),
  ]);
  if (user) {
    shellUser = {
      isArtist: !!user.isArtist || user.role === 'artist',
      isAdmin: user.role === 'admin',
      walletBalance: wallet?.balanceUsdc != null ? Number(wallet.balanceUsdc).toFixed(2) : '0.00',
      displayName: user.displayName ?? undefined,
      username: user.username ?? undefined,
    };
  }

  // Global authed layout. The PlayerBar lives here so it's mounted on
  // every authed page, including /song/[id] (which doesn't wrap in
  // AppShell). It owns the real <audio> element that listens for
  // pazzera:play events and actually plays music.
  return (
    <ShellUserProvider value={shellUser}>
      {children}
      <PaymentToastHost />
      <PlayerBar />
    </ShellUserProvider>
  );
}