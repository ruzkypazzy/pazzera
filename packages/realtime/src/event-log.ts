/**
 * Phase 8 — Event Log.
 *
 * Centralized append-only sink for every realtime event that the admin
 * dashboard needs to see (payment_due, payment_settled, stream_start/end,
 * socket_disconnect, etc.). Decouples observability from socket transport
 * state — admin can replay/audit even after the socket times out.
 */
import { prisma } from '@pazzera/db';

export type PaymentEventKind =
  | 'payment_due'
  | 'payment_settled'
  | 'payment_failed'
  | 'stream_start'
  | 'stream_end'
  | 'socket_disconnect'
  | 'threshold_crossed';

export async function recordEvent(opts: {
  kind: PaymentEventKind;
  streamId?: string;
  paymentId?: string;
  songId?: string;
  userId?: string;
  amountUsdc?: string;
  severity?: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const meta = opts.meta ? JSON.parse(JSON.stringify(opts.meta)) : undefined;
    await prisma.paymentEvent.create({
      data: {
        kind: opts.kind,
        streamId: opts.streamId,
        paymentId: opts.paymentId,
        songId: opts.songId,
        userId: opts.userId,
        amountUsdc: opts.amountUsdc,
        severity: opts.severity ?? 0,
        meta,
      },
    });
  } catch {
    // Don't fail the call site over observability writes.
  }
}

/**
 * Per-minute aggregates (Prisma-driven, server-agnostic).
 * Used by `/api/admin/streaming-health`.
 */
export async function getRecentEventCounts(): Promise<{
  payment_due_per_min: number;
  payment_settled_per_min: number;
  socket_disconnect_per_min: number;
  suspicious_streams_per_min: number;
}> {
  const since = new Date(Date.now() - 60_000);
  const [a, b, c, d] = await Promise.all([
    prisma.paymentEvent.count({ where: { kind: 'payment_due', createdAt: { gte: since } } }),
    prisma.paymentEvent.count({ where: { kind: 'payment_settled', createdAt: { gte: since } } }),
    prisma.paymentEvent.count({ where: { kind: 'socket_disconnect', createdAt: { gte: since } } }),
    prisma.paymentEvent.count({ where: { kind: 'stream_end', createdAt: { gte: since }, severity: { gte: 25 } } }),
  ]);
  return {
    payment_due_per_min: a,
    payment_settled_per_min: b,
    socket_disconnect_per_min: c,
    suspicious_streams_per_min: d,
  };
}
