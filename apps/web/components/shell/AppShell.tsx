'use client';

import React from 'react';
import { TopHeader } from './TopHeader';
import { BottomNav } from './BottomNav';
import { SessionBootstrap } from './SessionBootstrap';

type Props = {
  children: React.ReactNode;
  isArtist?: boolean;
  isAdmin?: boolean;
  walletBalance?: string;
};

export function AppShell({
  children,
  isArtist = false,
  isAdmin = false,
  walletBalance = '0.00',
}: Props) {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <SessionBootstrap />
      <TopHeader isArtist={isArtist} isAdmin={isAdmin} walletBalance={walletBalance} />
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