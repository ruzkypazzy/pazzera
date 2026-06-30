'use client';
import { useEffect, useState } from 'react';

/**
 * Polls /api/auth/session every 2s while wallet is in pending_provisioning
 * and disappears once wallet becomes 'active'.
 */
export function WalletStatusBanner() {
  const [status, setStatus] = useState<'pending_provisioning' | 'active' | 'frozen' | 'compromised' | 'recovery_requested' | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch('/api/auth/session');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStatus(data?.wallet?.status ?? null);
        if (data?.wallet?.status === 'active' || data?.wallet?.status == null) {
          return; // stop polling
        }
      } catch {
        // ignore
      }
      timer = setTimeout(tick, 2000);
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (dismissed || status !== 'pending_provisioning') return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm animate-fade-in"
    >
      <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent animate-pulse" />
      <div className="flex-1">
        <div className="font-medium text-fg">Setting up your wallet</div>
        <p className="text-fg-muted text-xs mt-0.5">
          Your Arc USDC wallet is being provisioned in the background. This usually takes a few
          seconds.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-fg-muted hover:text-fg text-xs"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}