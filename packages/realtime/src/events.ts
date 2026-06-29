/**
 * Typed Socket.IO event schemas.
 *
 * The server is the source of truth. Clients only echo position/pause/play.
 */

export interface ClientToServerEvents {
  /** Join a stream room; ticket was issued by /api/streams/start. */
  'stream:join': (payload: { streamId: string; ticket: string }) => void;
  'stream:leave': (payload: { streamId: string }) => void;

  /** Playback tick (every 5s from the client). */
  'stream:position': (payload: {
    streamId: string;
    positionSec: number;
    monotonicMs: number;
  }) => void;

  /** Client reports a seek. */
  'stream:seek': (payload: {
    streamId: string;
    fromSec: number;
    toSec: number;
  }) => void;

  /** Client reports pause/resume. */
  'stream:pause': (payload: { streamId: string; monotonicMs: number }) => void;
  'stream:resume': (payload: { streamId: string; monotonicMs: number }) => void;

  /** Stream finished naturally. */
  'stream:end': (payload: { streamId: string; monotonicMs: number }) => void;

  /** EIP-712 signature delivered for the due payment. */
  'stream:payment_signed': (payload: {
    streamId: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
      v: number;
      r: string;
      s: string;
    };
  }) => void;
}

export interface ServerToClientEvents {
  'stream:joined': (payload: {
    streamId: string;
    thresholdSec: number;
    serverTime: number;
  }) => void;

  'stream:error': (payload: {
    streamId: string;
    code: string;
    message: string;
  }) => void;

  /** Server says: payment is due, please sign. */
  'stream:payment_due': (payload: {
    streamId: string;
    songId: string;
    amountUsdc: string;
    recipient: string;
    nonce: string;
    validAfter: string;
    validBefore: string;
  }) => void;

  /** Payment was settled on-chain. */
  'stream:payment_settled': (payload: {
    streamId: string;
    paymentId: string;
    txHash: string;
  }) => void;

  /** Payout distribution done. */
  'stream:payout_done': (payload: {
    streamId: string;
    paymentId: string;
    totalDistributed: string;
    recipients: { username: string; amount: string }[];
  }) => void;

  /** Heartbeat ack. */
  'stream:tick_ack': (payload: { streamId: string; monotonicMs: number }) => void;
}

export interface InterServerEvents {
  // Reserved for scaling to multiple Socket.IO nodes with the Redis adapter.
  'admin:broadcast': (payload: { type: string; data: unknown }) => void;
}

export interface SocketData {
  userId?: string;
  activeStreamId?: string;
}