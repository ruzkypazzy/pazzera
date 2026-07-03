'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

type SessionState = {
  walletBalance: string | null;
  isArtist: boolean | null;
  role: string | null;
  displayName: string | null;
  username: string | null;
  setAll: (s: Partial<SessionState>) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  walletBalance: null,
  isArtist: null,
  role: null,
  displayName: null,
  username: null,
  setAll: (s) => set(s),
}));

/**
 * Fetches /api/auth/session once on mount and pushes the values into
 * the useSessionStore zustand store. Consumed by TopHeader + the wallet
 * pill. Lives in its own file because bundlers occasionally mis-trim
 * useEffects embedded inside larger client components.
 */
export function SessionBootstrap() {
  const setAll = useSessionStore((s) => s.setAll);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: any) => {
        if (cancelled || !d?.authenticated) return;
        const patch: Partial<SessionState> = { role: d.user?.role ?? null };
        if (typeof d.wallet?.balanceUsdc !== 'undefined' && d.wallet?.balanceUsdc !== null) {
          patch.walletBalance = Number(d.wallet.balanceUsdc).toFixed(2);
        }
        if (d.user?.isArtist === true || d.user?.role === 'artist' || d.user?.role === 'admin') {
          patch.isArtist = true;
        } else {
          patch.isArtist = false;
        }
        patch.displayName = d.user?.displayName ?? null;
        patch.username = d.user?.username ?? null;
        setAll(patch);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setAll]);
  return null;
}