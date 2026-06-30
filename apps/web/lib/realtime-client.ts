/**
 * Phase 8 — Client-side Socket.IO wrapper.
 *
 * Responsibilities:
 *   - Lazy-connect when the user starts playing a track.
 *   - Send playback:start, playback:tick (every 5s + on demand).
 *   - Handle reconnect via sessionToken; replay any buffered ticks on resume.
 *   - Expose a typed EventTarget-style API for components to subscribe to:
 *       payment_due, payment_settled, payment_failed, threshold_crossed,
 *       joined, ack_tick, error, disconnected.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@pazzera/realtime';
import type { PlaybackTickPayload } from '@pazzera/realtime';
import { getCookie } from './cookie';

const TICK_INTERVAL_MS = 5_000;
const SOCKET_URL = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_REALTIME_URL) || 'http://localhost:3001';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
let sessionToken: string | null = null;
let songId: string | null = null;
let durationSec = 0;
let bufferedTicks: PlaybackTickPayload[] = [];
const MAX_BUFFERED = 60;
let isReconnecting = false;
let visibleFlushTimer: ReturnType<typeof setInterval> | null = null;

export interface PlaybackState {
  positionSec: number;
  muted: boolean;
  hidden: boolean;
  playbackRate: number;
  volume: number;
  queuePosition: number;
}

export function emit(event: string, payload: unknown): void {
  const set = eventListeners.get(event);
  if (!set) return;
  for (const fn of set) fn(payload);
}

function on(event: string, fn: (payload: unknown) => void): () => void {
  let set = eventListeners.get(event);
  if (!set) {
    set = new Set();
    eventListeners.set(event, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

export function subscribePaymentDue(fn: (p: unknown) => void): () => void { return on('payment_due', fn); }
export function subscribePaymentSettled(fn: (p: unknown) => void): () => void { return on('payment_settled', fn); }
export function subscribePaymentFailed(fn: (p: unknown) => void): () => void { return on('payment_failed', fn); }
export function subscribeThresholdCrossed(fn: (p: unknown) => void): () => void { return on('threshold_crossed', fn); }
export function subscribeJoined(fn: (p: unknown) => void): () => void { return on('joined', fn); }
export function subscribeAckTick(fn: (p: unknown) => void): () => void { return on('ack_tick', fn); }
export function subscribeError(fn: (p: unknown) => void): () => void { return on('error', fn); }
export function subscribeDisconnected(fn: (p: unknown) => void): () => void { return on('disconnected', fn); }

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
  return socket;
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}

export async function startRealtime(opts: {
  userId: string;
  songId: string;
  durationSec: number;
  playbackState: () => PlaybackState;
  isResume?: boolean;
}): Promise<string> {
  if (socket && socket.connected) {
    return sessionToken ?? '';
  }
  if (socket) {
    // already trying
    return sessionToken ?? '';
  }

  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    auth: {
      userId: opts.userId,
      sessionToken: getCookie('csrf'),
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_500,
    reconnectionDelayMax: 8_000,
  });

  // Wire server events to our EventTarget
  socket.on('connect', () => {
    emit('connected', { connected: true });
    if (isReconnecting && sessionToken) {
      // Replay any client-side buffered ticks
      if (bufferedTicks.length > 0) {
        socket!.emit('playback:flush_buffer', {
          streamId: sessionToken,
          sessionToken,
          ticks: bufferedTicks,
        });
        bufferedTicks = [];
      }
    }
  });
  socket.on('disconnect', (reason) => {
    isReconnecting = true;
    emit('disconnected', { reason });
  });
  socket.on('joined', (p) => emit('joined', p));
  socket.on('threshold_crossed', (p) => emit('threshold_crossed', p));
  socket.on('payment_due', (p) => emit('payment_due', p));
  socket.on('payment_settled', (p) => emit('payment_settled', p));
  socket.on('payment_failed', (p) => emit('payment_failed', p));
  socket.on('ack_tick', (p) => emit('ack_tick', p));
  socket.on('error', (p) => emit('error', p));
  socket.on('disconnected' as never, (p: never) => emit('disconnected', p));

  // Wait for connect, then emit playback:start
  await new Promise<void>((resolve) => {
    socket!.on('connect', () => resolve());
  });
  // Generate / restore session token
  sessionToken = opts.isResume && sessionToken ? sessionToken : `cs_${crypto.randomUUID().replace(/-/g, '')}`;
  songId = opts.songId;
  durationSec = opts.durationSec;
  socket!.emit('playback:start', {
    userId: opts.userId,
    sessionId: sessionToken,
    songId: opts.songId,
    currentTimeSec: opts.playbackState().positionSec,
    durationSec: opts.durationSec,
    muted: opts.playbackState().muted,
    hidden: opts.playbackState().hidden,
    playbackRate: opts.playbackState().playbackRate,
    volume: opts.playbackState().volume,
    timestamp: Date.now(),
    queuePosition: opts.playbackState().queuePosition,
    isResume: !!opts.isResume,
  });
  startTicker(opts.playbackState);

  // Visibility change handler — flush buffer on tab focus
  if (typeof document !== 'undefined') {
    if (visibleFlushTimer) clearInterval(visibleFlushTimer);
    visibleFlushTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && bufferedTicks.length > 0 && isConnected()) {
        socket?.emit('playback:flush_buffer', { streamId: sessionToken ?? '', sessionToken: sessionToken ?? '', ticks: bufferedTicks });
        bufferedTicks = [];
      }
    }, 5_000);
  }

  return sessionToken;
}

function startTicker(getState: () => PlaybackState): void {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    if (!socket || !sessionToken || !songId) return;
    const state = getState();
    const payload: PlaybackTickPayload = {
      sessionId: sessionToken,
      songId,
      currentTimeSec: state.positionSec,
      durationSec,
      muted: state.muted,
      hidden: state.hidden,
      playbackRate: state.playbackRate,
      volume: state.volume,
      timestamp: Date.now(),
      queuePosition: state.queuePosition,
    };
    if (!socket.connected) {
      if (bufferedTicks.length < MAX_BUFFERED) bufferedTicks.push(payload);
    } else {
      socket.emit('playback:tick', payload);
    }
  }, TICK_INTERVAL_MS);
}

export async function pause(): Promise<void> {
  if (!socket || !sessionToken || !songId) return;
  socket.emit('playback:pause', {
    sessionId: sessionToken,
    songId,
    positionSec: 0,
    timestamp: Date.now(),
  });
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

export async function resume(getState: () => PlaybackState): Promise<void> {
  if (!socket || !sessionToken || !songId) {
    // Need to reconnect
    return;
  }
  socket.emit('playback:resume', {
    sessionId: sessionToken,
    songId,
    positionSec: getState().positionSec,
    timestamp: Date.now(),
  });
  startTicker(getState);
}

export async function seek(fromSec: number, toSec: number): Promise<void> {
  if (!socket || !sessionToken || !songId) return;
  socket.emit('playback:seek', {
    sessionId: sessionToken,
    songId,
    fromSec,
    toSec,
    timestamp: Date.now(),
  });
}

export async function end(): Promise<void> {
  if (!socket || !sessionToken || !songId) return;
  socket.emit('playback:end', {
    sessionId: sessionToken,
    songId,
    reason: 'natural',
    finalPositionSec: 0,
    timestamp: Date.now(),
  });
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  sessionToken = null;
  songId = null;
}

export async function disconnect(): Promise<void> {
  if (tickInterval) clearInterval(tickInterval);
  if (visibleFlushTimer) clearInterval(visibleFlushTimer);
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  sessionToken = null;
  songId = null;
  bufferedTicks = [];
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function getBufferedTickCount(): number {
  return bufferedTicks.length;
}
