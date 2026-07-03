'use client';

import React from 'react';
import { TopHeader } from './TopHeader';
import { BottomNav } from './BottomNav';
import { useShellUser } from './ShellUserContext';

type Props = {
  children: React.ReactNode;
  isArtist?: boolean;
  isAdmin?: boolean;
  walletBalance?: string;
  displayName?: string;
  username?: string;
};

/**
 * Client shell. Source of truth for role + wallet balance is the
 * `ShellUserContext` populated by `app/(app)/layout.tsx` (server-side
 * Prisma fetch on every navigation). Explicit props win over the
 * context so a page can override (rare).
 */
export function AppShell({
  children,
  isArtist: isArtistProp,
  isAdmin: isAdminProp,
  walletBalance: walletBalanceProp,
  displayName: displayNameProp,
  username: usernameProp,
}: Props) {
  const ctx = useShellUser();
  const isArtist = isArtistProp ?? ctx.isArtist;
  const isAdmin = isAdminProp ?? ctx.isAdmin;
  const walletBalance = walletBalanceProp ?? ctx.walletBalance;
  const displayName = displayNameProp ?? ctx.displayName;
  const username = usernameProp ?? ctx.username;

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