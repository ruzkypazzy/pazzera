/**
 * Phase 8 — Typed Socket.IO event schemas (server + client).
 *
 * Contract (Pazzera realtime protocol v3):
 *
 *   Client emits:
 *     playback:start     — first connect after pressing play
 *     playback:tick      — every 5s
 *     playback:pause
 *     playback:resume
 *     playback:seek
 *     playback:end
 *
 *   Server emits:
 *     joined
 *     threshold_crossed
 *     payment_due        — Fan Agent says charge this, sign & return
 *     payment_settled    — facilitator confirmed on-chain
 *     payment_failed
 *     disconnected
 *     error
 *
 *   Rooms:
 *     stream:<streamId>     — the listener + the system (payment_fanout side)
 *     admin                 — admin dashboard subscribers (read-only)
 */

import type {
  PlaybackTickPayload,
  PaymentDuePayload,
  PaymentSettledPayload,
  PaymentFailedPayload,
  ThresholdCrossedPayload,
  StreamStartPayload,
  StreamEndPayload,
  StreamSeekPayload,
  StreamPausePayload,
  StreamResumePayload,
  StreamResumeAckPayload,
  ErrorPayload,
  ServerTickAckPayload,
  PaymentAuthorizedPayload,
  PaymentAuthorizedAck,
} from './protocol';

export interface ClientToServerEvents {
  'playback:start': (payload: StreamStartPayload, ack?: (r: StreamResumeAckPayload) => void) => void;
  'playback:tick': (payload: PlaybackTickPayload, ack?: (r: ServerTickAckPayload) => void) => void;
  'playback:pause': (payload: StreamPausePayload) => void;
  'playback:resume': (payload: StreamResumePayload) => void;
  'playback:seek': (payload: StreamSeekPayload) => void;
  'playback:end': (payload: StreamEndPayload) => void;
  /** After reconnect — sends any client-buffered ticks that haven't reached the server. */
  'playback:flush_buffer': (payload: {
    streamId: string;
    sessionToken: string;
    ticks: PlaybackTickPayload[];
  }) => void;
  /** Phase 9 — client returns a signed x402 envelope. Rate-limited + nonce-protected. */
  'payment_authorized': (payload: PaymentAuthorizedPayload, ack?: (r: PaymentAuthorizedAck) => void) => void;
}

export interface ServerToClientEvents {
  joined: (payload: { streamId: string; thresholdSec: number; serverTime: number }) => void;
  threshold_crossed: (payload: ThresholdCrossedPayload) => void;
  payment_due: (payload: PaymentDuePayload) => void;
  payment_settled: (payload: PaymentSettledPayload) => void;
  payment_failed: (payload: PaymentFailedPayload) => void;
  disconnected: (payload: { streamId: string; reason: 'rate_limited' | 'invalid_payloads' | 'timeout' | 'server_shutdown' }) => void;
  error: (payload: ErrorPayload) => void;
  ack_tick: (payload: ServerTickAckPayload) => void;
}

export interface InterServerEvents {
  // Redis adapter pads for horizontal scaling (Phase 11). Currently unused.
  ping: () => void;
}

export interface SocketData {
  userId?: string;
  isAdmin?: boolean;
  streamId?: string;
  /** Used for disconnect-rate tracking. */
  connectedAt?: number;
  /** Per-socket invalid payload counter for the rate-limiter. */
  invalidPayloads?: number;
  /** ISO most-recent tick timestamp. */
  lastTickAt?: number;
  /** One-shot guard so threshold_crossed is emitted once per stream. */
  thresholdEmitted?: boolean;
}

export type { PlaybackTickPayload } from './protocol';
