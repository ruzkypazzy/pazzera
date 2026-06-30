'use client';

/**
 * Phase 10 — connection status badge for the realtime socket.
 *
 * Subscribes to `subscribeConnectionStatus(...)` and renders a small
 * pill at the top of the sticky player that the user (and the e2e
 * suite) can read for state.
 */
import { useEffect, useState } from 'react';
import {
  subscribeConnectionStatus,
  getConnectionStatus,
  type ConnectionStatus,
} from '@/lib/realtime-client';

const LABELS: Record<ConnectionStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
  failed: 'Connection failed',
};

const TONES: Record<ConnectionStatus, string> = {
  idle: 'bg-bg-muted text-fg-muted',
  connecting: 'bg-warning/10 text-warning',
  connected: 'bg-success/10 text-success',
  reconnecting: 'bg-warning/10 text-warning animate-pulse',
  disconnected: 'bg-danger/10 text-danger',
  failed: 'bg-danger/20 text-danger animate-pulse',
};

export function ConnectionStatusBadge(): JSX.Element | null {
  const [status, setStatus] = useState<ConnectionStatus>(getConnectionStatus());
  useEffect(() => subscribeConnectionStatus(setStatus), []);
  if (status === 'idle') return null;
  return (
    <span
      data-testid="connection-status"
      data-status={status}
      className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[status]}`}
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
