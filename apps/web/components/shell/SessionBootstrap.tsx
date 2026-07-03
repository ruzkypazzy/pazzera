'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

type SessionState = {
  walletBalance: string | null;
  isArtist: boolean | null;
  role: string | null;
  displayName: string | null;
  username: string | null;
};

export const useSessionStore = create<SessionState>(() => ({
  walletBalance: null,
  isArtist: null,
  role: null,
  displayName: null,
  username: null,
}));

// Module-level fetch — runs once when this module is first imported
// on the client. Bypasses React hook rules that some bundlers seem to
// mis-handle, and the singleton pattern guarantees a single in-flight
// request across every page mount.
let bootstrapPromise: Promise<void> | null = null;
function bootstrapSession() {
  if (typeof window === 'undefined') return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = fetch('/api/auth/session', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: any) => {
      if (!d?.authenticated) return;
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
      useSessionStore.setState(patch);
    })
    .catch(() => undefined);
  return bootstrapPromise;
}

// Kick off the fetch as a side effect of module evaluation.
bootstrapSession();

/**
 * Renders a hidden sentinel so React keeps the module alive, and runs
 * the bootstrap on mount for any client that hasn't imported this file
 * yet. The actual fetch is deduplicated by the singleton above.
 */
export function SessionBootstrap() {
  useEffect(() => {
    bootstrapSession();
  }, []);
  return <span aria-hidden="true" style={{ display: 'none' }} data-session-bootstrap="1" />;
}