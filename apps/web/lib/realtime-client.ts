/**
 * Phase 8 + Phase 10 production-hardening — Client-side Socket.IO wrapper.
 *
 * Responsibilities:
 *   - Lazy-connect when the user starts playing a track.
 *   - Send playback:start, playback:tick (every 5s + on demand).
 *   - Handle reconnect via sessionToken; replay any buffered ticks on
 *     resume via the `playback:flush_buffer` event.
 *   - Expose a typed EventTarget-style API for components to subscribe
 *     to: payment_due, payment_settled, payment_failed,
 *     threshold_crossed, joined, ack_tick, error, disconnected,
 *     connected.
 *   - Production-grade: explicit `connection-status` lifecycle for the
 *     UI badge, retry-with-jitter around `socket.connect()`, grace
 *     cycle on permanent close, and an `AbortSignal` to cancel
 *     mid-backoff.
 */
import { io, type Socket } from 'socket.io-client';
import { retry } from './retry';

const TICK_INTERVAL_MS = 5_000;
// Socket.IO is hosted by the Next.js server on the same origin. Browsers
// hit pazzera.com/socket.io/ which nginx proxies to the same listener
// that serves the Next.js app. In dev, window.location.origin is also
// the dev server. NEXT_PUBLIC_REALTIME_URL is kept as an optional
// override (e.g. for tests pointing at a mock server).
const SOCKET_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_REALTIME_URL) ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

let socket: Socket | null = null;
let currentStatus: ConnectionStatus = 'idle';
const statusListeners = new Set<(s: ConnectionStatus) => void>();
let tickInterval: ReturnType<typeof setInterval> | null = null;
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
let sessionToken: string | null = null;
let songId: string | null = null;
let durationSec = 0;
const bufferedTicks: unknown[] = [];
const MAX_BUFFERED = 60;
let isReconnecting = false;
let visibleFlushTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAborts: AbortController | null = null;

function setStatus(s: ConnectionStatus): void {
  if (currentStatus === s) return;
  currentStatus = s;
  for (const fn of statusListeners) fn(s);
  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-connection-status', s);
  }
}

function emit(event: string, payload: unknown): void {
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

export function subscribeConnectionStatus(fn: (s: ConnectionStatus) => void): () => void {
  statusListeners.add(fn);
  fn(currentStatus);
  return () => statusListeners.delete(fn);
}
export function getConnectionStatus(): ConnectionStatus { return currentStatus; }

export function getSocket(): Socket | null { return socket; }
export function isConnected(): boolean { return socket?.connected ?? false; }

async function openSocket(): Promise<Socket> {
  setStatus(isReconnecting ? 'reconnecting' : 'connecting');
  const s = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    auth: {
      // Real CSRF will be substituted by the server once we re-issue
      // session tokens. For Phase 10 we send no token (server picks
      // anon cohort if missing).
    },
    reconnection: false, // Phase 10: manual retry-with-jitter
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    s.once('connect', () => { if (!settled) { settled = true; resolve(); } });
    s.once('connect_error', (e) => { if (!settled) { settled = true; reject(e); } });
    setTimeout(() => { if (!settled) { settled = true; reject(new Error('connect timeout')); } }, 5000);
  });

  setStatus('connected');
  isReconnecting = false;

  s.on('disconnect', (reason) => {
    emit('disconnected', { reason });
    // Phase 10: schedule a backoff loop instead of relying on socket.io
    // internal reconnection.
    scheduleReconnect();
  });
  s.on('joined', (p) => emit('joined', p));
  s.on('threshold_crossed', (p) => emit('threshold_crossed', p));
  s.on('payment_due', (p) => emit('payment_due', p));
  s.on('payment_settled', (p) => emit('payment_settled', p));
  s.on('payment_failed', (p) => emit('payment_failed', p));
  s.on('ack_tick', (p) => emit('ack_tick', p));
  s.on('error', (p) => emit('error', p));
  return s;
}

function scheduleReconnect(): void {
  if (reconnectAborts) return; // already reconnecting
  reconnectAborts = new AbortController();
  setStatus('reconnecting');
  isReconnecting = true;
  retry(
    async () => {
      socket = await openSocket();
      // Replay any buffered ticks collected while disconnected.
      if (sessionToken && songId && bufferedTicks.length > 0) {
        flushReplay(socket, sessionToken);
      }
    },
    {
      attempts: 8,
      baseDelayMs: 500,
      maxDelayMs: 15_000,
      signal: reconnectAborts!.signal,
    },
  ).catch(() => {
    setStatus('failed');
    isReconnecting = false;
  });
}

function flushReplay(sock: Socket, token: string): void {
  if (bufferedTicks.length === 0) return;
  sock.emit('playback:flush_buffer', {
    streamId: token,
    sessionToken: token,
    ticks: bufferedTicks,
  });
  bufferedTicks.length = 0;
}

export async function startRealtime(opts: {
  userId: string;
  songId: string;
  durationSec: number;
  playbackState: () => PlaybackState;
  isResume?: boolean;
}): Promise<string> {
  // Same song on a live socket → resume; nothing to (re)start.
  if (socket && songId === opts.songId) return sessionToken ?? '';

  // Different song on a live socket → close out the previous stream
  // so its end-of-stream Fan Agent run fires, then start a new one.
  if (socket && socket.connected && songId && songId !== opts.songId) {
    socket.emit('playback:end', {
      sessionId: sessionToken ?? '',
      songId,
      reason: 'skipped',
      finalPositionSec: opts.playbackState().positionSec,
      timestamp: Date.now(),
    });
  }

  if (!socket || !socket.connected) {
    try {
      socket = await openSocket();
    } catch {
      scheduleReconnect();
      // Continue optimistically — UI shows the reconnecting state.
    }
  }
  sessionToken = opts.isResume && sessionToken
    ? sessionToken
    : `cs_${crypto.randomUUID().replace(/-/g, '')}`;
  songId = opts.songId;
  durationSec = opts.durationSec;
  socket?.emit('playback:start', {
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

  if (typeof document !== 'undefined') {
    if (visibleFlushTimer) clearInterval(visibleFlushTimer);
    visibleFlushTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && bufferedTicks.length > 0 && isConnected()) {
        socket?.emit('playback:flush_buffer', {
          streamId: sessionToken ?? '',
          sessionToken: sessionToken ?? '',
          ticks: bufferedTicks,
        });
        bufferedTicks.length = 0;
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
    const payload = {
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

export interface PlaybackState {
  positionSec: number;
  muted: boolean;
  hidden: boolean;
  playbackRate: number;
  volume: number;
  queuePosition: number;
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
  if (!socket || !sessionToken || !songId) return;
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
  reconnectAborts?.abort();
  reconnectAborts = null;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  sessionToken = null;
  songId = null;
  bufferedTicks.length = 0;
  setStatus('idle');
}

export function getSessionToken(): string | null { return sessionToken; }
export function getBufferedTickCount(): number { return bufferedTicks.length; }
