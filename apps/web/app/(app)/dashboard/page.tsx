import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/session';
import { prisma } from '@pazzera/core';
import { WalletStatusBanner } from '@/components/auth/wallet-status-banner';

export const metadata = { title: 'Dashboard — Pazzera' };

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/sign-in');
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { username: true, displayName: true, isArtist: true, role: true },
  });
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="space-y-6">
        <WalletStatusBanner />
        <header>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome{user?.displayName ? `, ${user.displayName}` : ''}
          </h1>
          <p className="text-fg-muted text-sm mt-1">
            Signed in as @{user?.username}
            {user?.isArtist ? ' · Artist account' : ' · Listener account'}
          </p>
        </header>
        <div className="rounded-2xl border border-border bg-bg-elevated p-8 text-center text-fg-muted">
          <p>The full dashboard lands in Phase 5.</p>
          <p className="text-xs mt-2">
            Auth, wallet provisioning, and session cookies are working — try refreshing.
          </p>
        </div>
      </div>
    </main>
  );
}