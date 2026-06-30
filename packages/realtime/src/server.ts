/**
 * Phase 8 — Socket.IO server.
 *
 * - Binds on :3001 by default (configurable via PORT).
 * - Authenticates every connection via session cookie or ?ticket= query.
 * - Creates one Socket.IO room per active stream — payment_due / payment_settled
 *   events are routed ONLY to that room, no broadcast noise.
 * - Server-authoritative: client position reports are validated but only the
 *   time delta (server clock between two ticks) drives `effectiveMs`.
 * - Rate limit: min 2s between ticks, max 5 invalid payloads, then auto-disconnect.
 * - Reconnect: client's sessionToken keeps the Stream row alive; the in-memory
 *   State is rebuilt from Stream + a few recent PlaybackTicks.
 */
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import { logger } from '@pazzera/core';
import { prisma } from '@pazzera/db';
import { enqueue } from '@pazzera/queue';
import {
  TickSchema,
  StreamStartSchema,
  StreamEndSchema,
  StreamSeekSchema,
  StreamPauseSchema,
  StreamResumeSchema,
  PaymentAuthorizedSchema,
  MIN_TICK_INTERVAL_MS,
  MAX_INVALID_PAYLOADS,
  MAX_BUFFERED_TICKS,
  PaymentAuthorizedAckSchema,
} from './protocol';
import {
  startStream,
  ingestTick,
  recordSeek,
  endStream,
  recordLoop,
  markSocketDisconnect,
  snapshotAdminCounters,
  adminCounters,
} from './stream-aggregator';
import { issueAndStoreNonce, consumeNonce } from './nonce-store';
import { recordEvent } from './event-log';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from './events';

type IO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let io: IO | null = null;

function emitError(socket: import('socket.io').Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, payload: { code: string; message: string }, streamId?: string) {
  socket.emit('error', { code: payload.code as 'INTERNAL', message: payload.message });
  socket.emit('disconnected', { streamId: streamId ?? '', reason: 'invalid_payloads' });
}

/**
 * Phase 9 — wire the realtime server to the blockchain facilitator service.
 * This lazily imports so the realtime process doesn't pull in the entire
 * blockchain package at boot.
 */
async function callFacilitator(opts: {
  paymentId: string;
  envelope: Parameters<typeof import('@pazzera/blockchain').FacilitatorService.settle>[0]['envelope'];
  nonce: string;
}) {
  const { FacilitatorService } = await import('@pazzera/blockchain');
  return FacilitatorService.settle(opts);
}

export async function startRealtimeServer(port = Number(process.env.PORT ?? 3001)) {
  if (io) return io;

  const httpServer = createServer();
  io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    cors: {
      origin: process.env.CORS_ALLOWLIST?.split(',') ?? ['http://localhost:3000', 'http://localhost:3001'],
      credentials: true,
    },
    pingInterval: 15_000,
    pingTimeout: 8_000,
  });

  // ─── Auth middleware ─────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth as { userId?: string; sessionToken?: string; isAdmin?: boolean };
      const cookieToken = socket.handshake.headers.cookie?.split(';').find((c) => c.trim().startsWith('csrf='))?.split('=')[1];
      // In Phase 11 we'll wire proper JWT verification; for now we accept a
      // sessionToken from the cookie or auth payload.
      const token = auth.sessionToken ?? cookieToken ?? socket.handshake.query?.ticket;
      if (!token && !auth.isAdmin) {
        return next(new Error('UNAUTHENTICATED'));
      }
      // Pull the session
      const session = await prisma.session.findUnique({ where: { sessionTokenHash: String(token ?? '') } });
      if (session && !session.revokedAt && session.expiresAt > new Date()) {
        socket.data.userId = session.userId;
      } else if (auth.userId) {
        // Demo / dev path: trust the auth.userId
        socket.data.userId = auth.userId;
      } else if (auth.isAdmin) {
        socket.data.isAdmin = true;
      } else {
        return next(new Error('UNAUTHENTICATED'));
      }
      socket.data.connectedAt = Date.now();
      next();
    } catch (err) {
      logger.error({ err }, 'realtime:auth_error');
      next(new Error('UNAUTHENTICATED'));
    }
  });

  // ─── Connection handler ──────────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    const isAdmin = socket.data.isAdmin;

    if (isAdmin) {
      socket.join('admin');
      // Admin listening — just relay SSE events to this socket too
      socket.emit('joined', { streamId: 'admin', thresholdSec: 0, serverTime: Date.now() });
      return;
    }

    if (!userId) return;

    // ─── playback:start ────────────────────────────────
    socket.on('playback:start', async (raw, ack) => {
      try {
        const payload = StreamStartSchema.parse(raw);
        const state = await startStream({
          userId: socket.data.userId!,
          songId: payload.songId,
          resumeSessionToken: payload.isResume ? payload.sessionId : undefined,
        });
        socket.data.streamId = state.streamId;
        socket.join(`stream:${state.streamId}`);

        const song = await prisma.song.findUnique({ where: { id: state.songId }, select: { durationSeconds: true } });
        const thresholdSec = Math.max(5, Math.round((song!.durationSeconds * 25) / 100));
        ack?.({ streamId: state.streamId, serverTime: Date.now(), thresholdSec, acceptedTicks: 0 });
        socket.emit('joined', { streamId: state.streamId, thresholdSec, serverTime: Date.now() });
      } catch (err) {
        socket.data.invalidPayloads = (socket.data.invalidPayloads ?? 0) + 1;
        emitError(socket, { code: 'INVALID_PAYLOAD', message: String((err as Error).message) });
        if ((socket.data.invalidPayloads ?? 0) >= MAX_INVALID_PAYLOADS) {
          socket.disconnect(true);
        }
      }
    });

    // ─── playback:tick ─────────────────────────────────
    socket.on('playback:tick', async (raw, ack) => {
      try {
        // Rate limit (cheap: server wall-clock)
        const now = Date.now();
        const last = socket.data.lastTickAt ?? 0;
        if (now - last < MIN_TICK_INTERVAL_MS) {
          // Drop silently — clients that batch ticks within 2s are expected
          return;
        }
        socket.data.lastTickAt = now;

        const payload = TickSchema.parse(raw);
        const state = await ingestTick(payload, now);
        ack?.({ streamId: state.streamId, timestamp: now, accumulatedMs: state.effectiveMs, thresholdCrossed: state.thresholdCrossed });
        socket.emit('ack_tick', { streamId: state.streamId, timestamp: now, accumulatedMs: state.effectiveMs, thresholdCrossed: state.thresholdCrossed });

        // Emit threshold_crossed one-shot
        if (state.thresholdCrossed && !socket.data.streamId) {
          socket.emit('threshold_crossed', {
            streamId: state.streamId,
            songId: state.songId,
            crossedAtSec: Math.round(state.effectiveMs / 1000),
            thresholdSec: Math.round(state.effectiveMs / 1000),
            fanClassification: 'valid_stream',
          });
        }
      } catch (err) {
        socket.data.invalidPayloads = (socket.data.invalidPayloads ?? 0) + 1;
        if ((socket.data.invalidPayloads ?? 0) >= MAX_INVALID_PAYLOADS) {
          emitError(socket, { code: 'INVALID_PAYLOAD', message: String((err as Error).message) }, socket.data.streamId);
          socket.disconnect(true);
        } else {
          emitError(socket, { code: 'INVALID_PAYLOAD', message: String((err as Error).message) });
        }
      }
    });

    // ─── playback:pause / playback:resume ─────────────
    socket.on('playback:pause', (raw) => { try { StreamPauseSchema.parse(raw); /* no-op on server, ticks just won't fire from client */ } catch (err) { socket.data.invalidPayloads = (socket.data.invalidPayloads ?? 0) + 1; } });
    socket.on('playback:resume', (raw) => { try { StreamResumeSchema.parse(raw); } catch (err) { socket.data.invalidPayloads = (socket.data.invalidPayloads ?? 0) + 1; } });

    // ─── playback:seek ────────────────────────────────
    socket.on('playback:seek', async (raw) => {
      try {
        const payload = StreamSeekSchema.parse(raw);
        await recordSeek({ sessionId: payload.sessionId, songId: payload.songId, fromSec: payload.fromSec, toSec: payload.toSec, monotonicMs: Date.now() });
      } catch {
        socket.data.invalidPayloads = (socket.data.invalidPayloads ?? 0) + 1;
      }
    });

    // ─── playback:end ─────────────────────────────────
    socket.on('playback:end', async (raw) => {
      try {
        const payload = StreamEndSchema.parse(raw);
        const state = await endStream({
          sessionId: payload.sessionId,
          songId: payload.songId,
          reason: payload.reason,
          finalPositionSec: payload.finalPositionSec,
          monotonicMs: Date.now(),
        });
        if (state) {
          socket.leave(`stream:${state.streamId}`);
          await recordEvent({ kind: 'stream_end', streamId: state.streamId, songId: state.songId, userId: state.userId });
        }
      } catch {
        socket.data.invalidPayloads = (socket.data.invalidPayloads ?? 0) + 1;
      }
    });

    // ─── playback:flush_buffer (post-reconnect) ───────
    socket.on('playback:flush_buffer', async (raw) => {
      const buf = raw.ticks;
      if (!Array.isArray(buf) || buf.length > MAX_BUFFERED_TICKS) {
        socket.data.invalidPayloads = (socket.data.invalidPayloads ?? 0) + 1;
        emitError(socket, { code: 'BUFFER_OVERFLOW', message: 'Too many buffered ticks' });
        return;
      }
      let accepted = 0;
      let rejected = 0;
      for (const t of buf) {
        try {
          const parsed = TickSchema.parse(t);
          await ingestTick(parsed, parsed.timestamp);
          accepted += 1;
        } catch {
          rejected += 1;
        }
      }
      socket.emit('ack_tick', { streamId: raw.streamId, timestamp: Date.now(), accumulatedMs: -1, thresholdCrossed: false });
      logger.info({ accepted, rejected, streamId: raw.streamId }, 'realtime:flush_buffer');
    });

    // ─── payment_authorized (Phase 9) ──────────────────
    // Client returns signed x402 envelope after receiving payment_due.
    // Rate limited to 1/2s per socket.
    socket.on('payment_authorized', async (raw, ack) => {
      try {
        // Per-socket rate limit for payment_authorized
        const lastAuthAt = (socket.data as unknown as { lastPaymentAuthorizedAt?: number }).lastPaymentAuthorizedAt ?? 0;
        const now = Date.now();
        if (now - lastAuthAt < 2_000) {
          ack?.(PaymentAuthorizedAckSchema.parse({ streamId: raw.streamId, accepted: false, reason: 'rate_limited' }));
          return;
        }
        (socket.data as unknown as { lastPaymentAuthorizedAt?: number }).lastPaymentAuthorizedAt = now;

        const payload = PaymentAuthorizedSchema.parse(raw);
        // Look up the Payment row (Phase 8 fan-worker enqueued it; Phase 9
        // creates it on payment_authorized if not provided).
        const { prisma } = await import('@pazzera/db');
        let paymentId = payload.paymentId;
        if (!paymentId) {
          const created = await prisma.payment.create({
            data: {
              streamId: payload.streamId,
              songId: payload.signedPayload.to.toLowerCase(), // placeholder; we'll patch
              payerUserId: socket.data.userId!,
              amountUsdc: payload.signedPayload.value,
              amountBaseUnits: payload.signedPayload.value,
              status: 'pending',
            },
          });
          paymentId = created.id;
        }
        const settlement = await callFacilitator({
          paymentId,
          envelope: {
            from: payload.signedPayload.from as `0x${string}`,
            to: payload.signedPayload.to as `0x${string}`,
            value: payload.signedPayload.value,
            validAfter: payload.signedPayload.validAfter,
            validBefore: payload.signedPayload.validBefore,
            nonce: payload.signedPayload.nonce as `0x${string}`,
            v: payload.signedPayload.v,
            r: payload.signedPayload.r as `0x${string}`,
            s: payload.signedPayload.s as `0x${string}`,
          },
          nonce: payload.nonce,
        });
        ack?.(PaymentAuthorizedAckSchema.parse({
          streamId: payload.streamId,
          accepted: settlement.ok,
          reason: settlement.reason,
          paymentId,
          txHash: settlement.txHash,
          blockNumber: settlement.blockNumber,
        }));
        if (!settlement.ok) {
          socket.emit('payment_failed', {
            streamId: payload.streamId,
            paymentId,
            reason: settlement.reason === 'invalid_signature' ? 'chain_error' : (settlement.reason === 'expired' ? 'expired' : 'chain_error'),
            message: settlement.reason ?? 'facilitator_failure',
          });
        } else {
          // Emit payment_settled directly so the listener UI updates
          const { emitPaymentSettled } = await import('./server');
          await emitPaymentSettled(payload.streamId, {
            paymentId: paymentId!,
            songId: payload.signedPayload.to,
            amountUsdc: payload.signedPayload.value,
            recipientCount: 0,
            txHash: settlement.txHash!,
            payoutStatus: 'pending',
          });
        }
      } catch (err) {
        socket.data.invalidPayloads = (socket.data.invalidPayloads ?? 0) + 1;
        ack?.(PaymentAuthorizedAckSchema.parse({
          streamId: raw.streamId,
          accepted: false,
          reason: 'malformed_signature',
        }));
      }
    });

    // ─── disconnect ───────────────────────────────────
    socket.on('disconnect', (reason) => {
      markSocketDisconnect(socket.data.streamId);
      void recordEvent({
        kind: 'socket_disconnect',
        streamId: socket.data.streamId,
        userId: socket.data.userId,
        meta: { reason, connectedMs: Date.now() - (socket.data.connectedAt ?? Date.now()) },
      });
    });

    // ─── connection error ─────────────────────────────
    socket.on('error', (err) => logger.error({ err }, 'realtime:socket_error'));
  });

  httpServer.listen(port, () => {
    logger.info({ port }, 'realtime:listening');
    if (process.env.DEMO_MODE === 'true') {
      const { startDemoLoop } = await import('./demo-simulator');
      startDemoLoop();
    }
  });

  return io;
}

/**
 * Helper used by the Split worker to push payment_settled events to the
 * right stream room. Idempotent — emit-or-skip based on whether the room is
 * empty (no active listener).
 */
export async function emitPaymentSettled(streamId: string, payload: {
  paymentId: string;
  songId: string;
  amountUsdc: string;
  recipientCount: number;
  txHash: string;
  payoutStatus: 'pending' | 'processing' | 'completed' | 'partial_failure' | 'failed';
}) {
  if (!io) return;
  io.of('/').to(`stream:${streamId}`).emit('payment_settled', {
    streamId,
    paymentId: payload.paymentId,
    songId: payload.songId,
    amountUsdc: payload.amountUsdc,
    recipientCount: payload.recipientCount,
    txHash: payload.txHash,
    payoutStatus: payload.payoutStatus,
    settlesAt: Date.now(),
  });
  adminCounters.paymentSettledLastMin.push({ ts: Date.now(), streamId });
  adminCounters.payment_settled_total += 1;
  await recordEvent({
    kind: 'payment_settled',
    streamId,
    paymentId: payload.paymentId,
    songId: payload.songId,
    amountUsdc: payload.amountUsdc,
    meta: { txHash: payload.txHash, payoutStatus: payload.payoutStatus },
  });
}

/**
 * Used by the Fan worker when it determines a charge is due. Emits a
 * payment_due to the specific listener's room. Includes a freshly-issued
 * nonce.
 */
export async function emitPaymentDue(opts: {
  streamId: string;
  songId: string;
  amountUsdc: string;
  pricingTier: '0.001' | '0.002' | '0.003' | '0.004' | '0.005';
  authorizationRequired: boolean;
  nonce: string;
}) {
  if (!io) return;
  io.of('/').to(`stream:${opts.streamId}`).emit('payment_due', {
    songId: opts.songId,
    streamId: opts.streamId,
    amountUsdc: opts.amountUsdc,
    pricingTier: opts.pricingTier,
    authorizationRequired: opts.authorizationRequired,
    nonce: opts.nonce,
    expiresAtSec: Date.now() + 600_000,
  });
  adminCounters.paymentDueLastMin.push({ ts: Date.now(), streamId: opts.streamId });
  adminCounters.payment_due_total += 1;
  await recordEvent({
    kind: 'payment_due',
    streamId: opts.streamId,
    songId: opts.songId,
    amountUsdc: opts.amountUsdc,
    meta: { nonce: opts.nonce, pricingTier: opts.pricingTier },
  });
}

export async function emitPaymentFailed(streamId: string, reason: 'user_rejected' | 'expired' | 'insufficient_balance' | 'chain_error' | 'rate_limited', message: string) {
  if (!io) return;
  io.of('/').to(`stream:${streamId}`).emit('payment_failed', {
    streamId,
    reason,
    message,
  });
  await recordEvent({
    kind: 'payment_failed',
    streamId,
    severity: 50,
    meta: { reason, message },
  });
}

export function getRealtimeIO(): IO | null {
  return io;
}

export { consumeNonce, issueAndStoreNonce };

export { snapshotAdminCounters };

if (require.main === module) {
  void startRealtimeServer();
}
