/**
 * Realtime client — Socket.IO connection + event subscription.
 *
 * Phase 5 uses a polling fallback that drives the live payment toast.
 * Phase 8 swaps in the real Socket.IO gateway.
 *
 * Demo mode: when DEMO_MODE=true, the client starts a fake event emitter
 * that fires a stream-qualified → split-distributed pair every 12s so
 * judges can see the live-payment toast without real on-chain activity.
 */
'use client';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  // The Next.js web app and the Socket.IO server share the same host in
  // production (Nginx routes /socket.io/ to the socket server on :3001).
  // In dev, the socket server is on localhost:3001.
  const url = typeof window !== 'undefined' ? window.location.origin : undefined;
  socket = io(url, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });
  return socket;
}

export function useRealtimePayments(onEvent: (evt: PaymentToastEvent) => void) {
  useEffect(() => {
    const s = getSocket();
    const handler = (evt: PaymentToastEvent) => onEvent(evt);
    s.on('stream:payment_settled', handler);
    s.on('stream:payout_done', handler);
    return () => {
      s.off('stream:payment_settled', handler);
      s.off('stream:payout_done', handler);
    };
  }, [onEvent]);
}

export type PaymentToastEvent =
  | {
      type: 'stream:payment_settled';
      streamId: string;
      songTitle?: string;
      artistUsername?: string;
      amountUsdc: string;
    }
  | {
      type: 'stream:payout_done';
      streamId: string;
      totalDistributed: string;
      recipients: { username: string; amount: string }[];
    };

/**
 * Demo mode simulation: fire a synthetic payment event every 12s.
 * Hook this from a top-level client component when DEMO_MODE is on.
 */
export function useDemoPaymentSimulation(enabled: boolean, onEvent: (evt: PaymentToastEvent) => void) {
  useEffect(() => {
    if (!enabled) return;
    let n = 0;
    const songs = [
      { title: 'Midnight Protocol', artist: 'ada' },
      { title: 'Pixel Dust', artist: 'pixel_pete' },
      { title: 'Lagos Sunrise', artist: 'tunde' },
      { title: 'Velvet Static', artist: 'claire' },
    ];
    const t = setInterval(() => {
      n += 1;
      const s = songs[n % songs.length]!;
      const price = ['0.002', '0.003', '0.004', '0.005'][n % 4]!;
      // Simulate Fan Agent trigger
      setTimeout(() => {
        onEvent({
          type: 'stream:payment_settled',
          streamId: `demo-${n}`,
          songTitle: s.title,
          artistUsername: s.artist,
          amountUsdc: price,
        });
      }, 200);
      // Simulate Split Agent distribution ~600ms later
      setTimeout(() => {
        onEvent({
          type: 'stream:payout_done',
          streamId: `demo-${n}`,
          totalDistributed: price,
          recipients: [
            { username: s.artist, amount: (Number(price) * 0.7).toFixed(6) },
            { username: 'tunde', amount: (Number(price) * 0.2).toFixed(6) },
            { username: 'beatsbyneo', amount: (Number(price) * 0.1).toFixed(6) },
          ],
        });
      }, 600);
    }, 12_000);
    return () => clearInterval(t);
  }, [enabled, onEvent]);
}