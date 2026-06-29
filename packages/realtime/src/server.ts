/**
 * Socket.IO server bootstrap.
 *
 * - Validates stream tickets on join
 * - Tracks playback state, emits payment_due when threshold crossed
 * - Routes EIP-712 signed payments to the payment queue
 */
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import { getEnv, logger } from '@pazzera/core';
import { prisma } from '@pazzera/db';
import { enqueue } from '@pazzera/queue';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from './events';
import {
  issueTicket,
  loadStreamState,
  clearState,
  getState,
  getUserActiveStream,
} from './session';

type IO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let io: IO | null = null;

export function createSocketServer(httpServer?: ReturnType<typeof createServer>): IO {
  if (io) return io;
  const env = getEnv();
  const server = httpServer ?? createServer();
  io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(server, {
    cors: {
      origin: env.ALLOWED_ORIGINS,
      credentials: true,
    },
    pingInterval: 20_000,
    pingTimeout: 10_000,
    maxHttpBufferSize: 1e5, // 100 KB max message
  });

  attachHandlers(io);
  return io;
}

function attachHandlers(io: IO): void {
  io.on('connection', (socket) => {
    logger.info({ sid: socket.id }, 'socket:connected');

    socket.on('stream:join', async ({ streamId, ticket }) => {
      try {
        const stream = await prisma.stream.findUnique({
          where: { id: streamId },
          select: { id: true, userId: true, endedAt: true },
        });
        if (!stream || stream.endedAt) {
          socket.emit('stream:error', {
            streamId,
            code: 'STREAM_NOT_FOUND',
            message: 'Stream not found or already ended',
          });
          return;
        }
        const state = await loadStreamState(streamId);
        if (!state) {
          socket.emit('stream:error', {
            streamId,
            code: 'STREAM_STATE_FAILED',
            message: 'Could not load stream state',
          });
          return;
        }
        // Verify ticket: it was signed at start time, tied to userId
        const { issueTicket: _ } = await import('./session');
        const expected = issueTicket(streamId, state.userId);
        if (expected !== ticket) {
          socket.emit('stream:error', {
            streamId,
            code: 'INVALID_TICKET',
            message: 'Ticket does not match stream',
          });
          return;
        }

        // Single active stream per user
        const existing = getUserActiveStream(state.userId);
        if (existing && existing !== streamId) {
          socket.emit('stream:error', {
            streamId,
            code: 'CONCURRENT_STREAM',
            message: 'User already has an active stream',
          });
          return;
        }

        socket.data.userId = state.userId;
        socket.data.activeStreamId = streamId;
        socket.join(`stream:${streamId}`);

        socket.emit('stream:joined', {
          streamId,
          thresholdSec: state.thresholdSec,
          serverTime: Date.now(),
        });
        logger.info(
          { streamId, userId: state.userId, sid: socket.id },
          'socket:stream_joined',
        );
      } catch (err) {
        logger.error({ err, streamId }, 'socket:join_failed');
        socket.emit('stream:error', {
          streamId,
          code: 'JOIN_FAILED',
          message: 'Internal error',
        });
      }
    });

    socket.on('stream:position', async ({ streamId, positionSec, monotonicMs }) => {
      const state = getState(streamId);
      if (!state || state.userId !== socket.data.userId) return;

      // Anti-bot: monotonic must be greater than last tick
      if (monotonicMs <= state.lastTickAtMs) return;
      const elapsed = monotonicMs - state.lastTickAtMs;
      const posDelta = positionSec - state.lastTickPositionSec;
      // Realistic playback: at most ~1.05x speed
      const expectedDelta = (elapsed / 1000) * 1.05;
      if (posDelta > expectedDelta + 0.5) {
        // Client lying about position. Reset threshold counter.
        state.recentSeekCount += 1;
        state.lastTickPositionSec = positionSec;
        state.lastTickAtMs = monotonicMs;
        if (state.recentSeekCount > 3) {
          await prisma.stream
            .update({
              where: { id: streamId },
              data: { flaggedAbuse: true },
            })
            .catch(() => undefined);
        }
        return;
      }
      state.recentSeekCount = 0;
      state.lastTickPositionSec = positionSec;
      state.lastTickAtMs = monotonicMs;
      state.totalActiveMs += elapsed;

      socket.emit('stream:tick_ack', { streamId, monotonicMs });

      // Threshold check
      if (
        !state.charged &&
        positionSec >= state.thresholdSec &&
        state.totalActiveMs >= 30_000 // at least 30s real elapsed
      ) {
        await triggerPayment(state);
      }
    });

    socket.on('stream:seek', ({ streamId, fromSec, toSec }) => {
      const state = getState(streamId);
      if (!state || state.userId !== socket.data.userId) return;
      const delta = Math.abs(toSec - fromSec);
      if (delta > 30) {
        // Large seek within playback → reset threshold counter
        state.recentSeekCount += 1;
        state.lastTickPositionSec = toSec;
        if (state.recentSeekCount > 1) {
          // Multiple large seeks → treat as abuse, kill stream eligibility
          prisma.stream
            .update({
              where: { id: streamId },
              data: { flaggedAbuse: true },
            })
            .catch(() => undefined);
        }
      } else {
        state.lastTickPositionSec = toSec;
      }
    });

    socket.on('stream:pause', ({ streamId }) => {
      const state = getState(streamId);
      if (!state) return;
      state.paused = true;
    });

    socket.on('stream:resume', ({ streamId }) => {
      const state = getState(streamId);
      if (!state) return;
      state.paused = false;
    });

    socket.on('stream:end', async ({ streamId }) => {
      const state = getState(streamId);
      if (!state || state.userId !== socket.data.userId) return;
      await prisma.stream
        .update({
          where: { id: streamId },
          data: { endedAt: new Date(), endReason: 'natural' },
        })
        .catch(() => undefined);
      clearState(streamId);
    });

    socket.on(
      'stream:payment_signed',
      async ({ streamId, authorization }) => {
        // Hand off to payment settlement queue
        await enqueue.paymentSettle({ streamId, authorization });
        logger.info({ streamId }, 'payment:authorized_received');
      },
    );

    socket.on('disconnect', () => {
      logger.info({ sid: socket.id, userId: socket.data.userId }, 'socket:disconnected');
    });
  });
}

async function triggerPayment(state: { streamId: string; songId: string; userId: string }) {
  // SETNX on the charged flag to prevent double-charge in multi-worker scenarios
  const { getQueueConnection } = await import('@pazzera/queue');
  const redis = getQueueConnection();
  const key = `stream:${state.streamId}:charged`;
  const set = await redis.set(key, '1', 'EX', 3600, 'NX');
  if (set !== 'OK') return;

  await prisma.stream
    .update({
      where: { id: state.streamId },
      data: { charged: true, chargedAt: new Date() },
    })
    .catch(() => undefined);

  await enqueue.fan({ streamId: state.streamId });
  state.charged = true;

  // Notify client — they sign and emit payment_signed
  io?.to(`stream:${state.streamId}`).emit('stream:payment_due', {
    streamId: state.streamId,
    songId: state.songId,
    amountUsdc: '0', // actual amount is computed by the Fan Agent before emit; client only signs what server dictates
    recipient: '', // server-provided in Phase 9
    nonce: '',
    validAfter: String(Math.floor(Date.now() / 1000)),
    validBefore: String(Math.floor(Date.now() / 1000) + 60),
  });
}

export function getIO(): IO | null {
  return io;
}

export function startSocketServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    const io = createSocketServer();
    const env = getEnv();
    const httpServer = io.httpServer ? (io.httpServer as unknown as { listen: (p: number, cb?: () => void) => void }) : null;
    if (httpServer) {
      httpServer.listen(port, () => {
        logger.info({ port, env: env.NODE_ENV }, 'realtime:listening');
        resolve();
      });
    } else {
      resolve();
    }
  });
}