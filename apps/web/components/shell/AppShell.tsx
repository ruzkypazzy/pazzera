import React from 'react';
import { headers } from 'next/headers';
import { prisma, getCurrentSession } from '@pazzera/core';
import { TopHeader } from './TopHeader';
import { BottomNav } from './BottomNav';

type Props = {
  children: React.ReactNode;
  isArtist?: boolean;
  isAdmin?: boolean;
  walletBalance?: string;
};

/**
 * Server-side shell: resolves the current session + wallet balance via
 * Prisma on every render, then passes authoritative values to the
 * client TopHeader/BottomNav. This is the source of truth for role +
 * balance shown in the header pill and the avatar dropdown — regardless
 * of whether the calling page set the prop or not.
 */
export async function AppShell({
  children,
  isArtist: isArtistProp,
  isAdmin: isAdminProp,
  walletBalance: walletBalanceProp,
}: Props) {
  const session = await getCurrentSession();
  let isArtist = !!isArtistProp;
  let isAdmin = !!isAdminProp;
  let walletBalance = walletBalanceProp ?? '0.00';
  let displayName: string | undefined;
  let username: string | undefined;
  if (session) {
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
      isArtist = isArtist || !!user.isArtist || user.role === 'artist';
      isAdmin = isAdmin || user.role === 'admin';
      displayName = user.displayName ?? undefined;
      username = user.username ?? undefined;
    }
    if (wallet?.balanceUsdc != null) {
      walletBalance = Number(wallet.balanceUsdc).toFixed(2);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <TopHeader
        isArtist={isArtist}
        isAdmin={isAdmin}
        walletBalance={walletBalance}
        displayName={displayName}
        username={username}
      />
      <main
        className="pt-[72px]"
        style={{
          // 68px bottom nav + 80px player (now in (app)/layout.tsx) + 24px breathing
          paddingBottom: '172px',
          minHeight: '100vh',
        }}
      >
        {children}
      </main>
      <BottomNav isArtist={isArtist} />
    </div>
  );
}