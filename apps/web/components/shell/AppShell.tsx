'use client';

import React from 'react';
import { TopHeader } from './TopHeader';
import { BottomNav } from './BottomNav';

type Props = {
  children: React.ReactNode;
  isArtist?: boolean;
  isAdmin?: boolean;
  walletBalance?: string;
  displayName?: string;
  username?: string;
};

/**
 * Client shell. Pages pass their own isArtist / walletBalance / displayName
 * / username props. We don't read from a shared context anymore — earlier
 * version of this file used ShellUserContext, but that pulled server-side
 * Prisma fetch into the global layout and broke client-side hydration
 * on /home for some users.
 */
export function AppShell({
  children,
  isArtist = false,
  isAdmin = false,
  walletBalance = '0.00',
  displayName,
  username,
}: Props) {
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