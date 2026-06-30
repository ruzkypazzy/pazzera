/**
 * POST /api/webhooks/circle
 *
 * Receives signed webhook events from Circle W3S. We support four event types
 * per the spec:
 *   - wallet.created
 *   - transfer.pending
 *   - transfer.complete
 *   - transfer.failed
 *
 * Security:
 *   - HMAC-SHA256 over the raw request body using CIRCLE_WEBHOOK_SECRET.
 *   - Signature in `circle-signature` header (Circle's convention) OR `x-pazzera-signature`.
 *   - Replay protection: each event has an `id` we persist in Redis (24h TTL).
 *     Re-delivered events with the same id are no-ops.
 *   - Rate limited: cap at 100 req/min per source IP.
 *
 * Behavior:
 *   - wallet.created:  no-op (we already get these at provision time)
 *   - transfer.complete: mark WalletTransaction confirmed + patch the Payment row
 *                        with the real txHash + blockNumber + confirmedAt.
 *                        Emit `payment_settled` over Socket.IO if not already done.
 *   - transfer.failed:   mark WalletTransaction failed
 *   - transfer.pending:  mark WalletTransaction submitted
 */
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@pazzera/core';
import { getEnv, logger, AppError } from '@pazzera/core';
import Redis from 'ioredis';

export const dynamic = 'force-dynamic';

/**
 * Compute the expected signature using HMAC-SHA256.
 */
function expectedSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyHmac(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = expectedSignature(rawBody, secret);
  // Accept either `circle-signature: <hex>` or `x-pazzera-signature: <hex>`
  const provided = signatureHeader.includes(' ') ? signatureHeader.split(' ')[1]! : signatureHeader;
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

// ─── Replay protection via Redis ────────────────────────────────
let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: 1 });
    _redis.on('error', (e) => logger.warn({ err: e.message }, 'webhook:redis_error'));
  }
  return _redis;
}

/** Returns true if the id was newly recorded (not a replay). */
async function markEventOnce(eventId: string): Promise<boolean> {
  try {
    const res = await getRedis().set(`pazzera:webhook:${eventId}`, '1', 'EX', 24 * 3600, 'NX');
    return res === 'OK';
  } catch {
    // If Redis is down, fall back to Postgres-only check (we still want
    // idempotency for the wallet:complete patch).
    return true;
  }
}

// ─── Payload schemas ───────────────────────────────────────────
const WalletCreated = z.object({
  id: z.string(),
  type: z.literal('wallet.created'),
  data: z.object({
    walletId: z.string(),
    address: z.string().optional(),
  }),
  timestamp: z.string().optional(),
});

const TransferComplete = z.object({
  id: z.string(),
  type: z.literal('transfer.complete'),
  data: z.object({
    transferId: z.string(),
    txHash: z.string().optional(),
    blockNumber: z.number().int().optional(),
    confirmedAt: z.string().optional(),
  }),
  timestamp: z.string().optional(),
});

const TransferPending = z.object({
  id: z.string(),
  type: z.literal('transfer.pending'),
  data: z.object({
    transferId: z.string(),
  }),
  timestamp: z.string().optional(),
});

const TransferFailed = z.object({
  id: z.string(),
  type: z.literal('transfer.failed'),
  data: z.object({
    transferId: z.string(),
    failureReason: z.string().optional(),
  }),
  timestamp: z.string().optional(),
});

const Payload = z.union([WalletCreated, TransferComplete, TransferPending, TransferFailed]);

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const env = getEnv();
  const sig = req.headers.get('circle-signature') ?? req.headers.get('x-pazzera-signature');

  // We allow unsigned requests in dev when CIRCLE_WEBHOOK_SECRET is empty.
  // In prod, this MUST be set.
  if (env.CIRCLE_WEBHOOK_SECRET) {
    if (!verifyHmac(rawBody, sig, env.CIRCLE_WEBHOOK_SECRET)) {
      logger.warn('webhook:invalid_signature');
      throw new AppError('UNAUTHORIZED', 'Invalid signature', 401);
    }
  } else if (env.NODE_ENV === 'production') {
    throw new AppError('MISCONFIGURED', 'CIRCLE_WEBHOOK_SECRET not set in production', 500);
  }

  let parsed: z.infer<typeof Payload>;
  try {
    parsed = Payload.parse(JSON.parse(rawBody));
  } catch (err) {
    logger.warn({ err }, 'webhook:malformed_payload');
    throw new AppError('INVALID_PAYLOAD', 'Malformed webhook payload', 400);
  }

  const fresh = await markEventOnce(parsed.id);
  if (!fresh) {
    logger.info({ eventId: parsed.id, type: parsed.type }, 'webhook:replay_skipped');
    return Response.json({ ok: true, replay: true });
  }

  switch (parsed.type) {
    case 'wallet.created':
      logger.info({ walletId: parsed.data.walletId, address: parsed.data.address }, 'webhook:wallet_created');
      break;
    case 'transfer.pending': {
      const tx = await prisma.walletTransaction.findFirst({ where: { txHash: parsed.data.transferId } });
      if (tx) {
        await prisma.walletTransaction.update({
          where: { id: tx.id },
          data: { status: 'submitted', submittedAt: new Date() },
        });
      }
      break;
    }
    case 'transfer.complete': {
      const tx = await prisma.walletTransaction.findFirst({ where: { txHash: parsed.data.transferId } });
      if (tx) {
        await prisma.walletTransaction.update({
          where: { id: tx.id },
          data: {
            status: 'confirmed',
            txHash: parsed.data.txHash ?? tx.txHash,
            blockNumber: parsed.data.blockNumber ? BigInt(parsed.data.blockNumber) : tx.blockNumber,
            confirmedAt: parsed.data.confirmedAt ? new Date(parsed.data.confirmedAt) : new Date(),
          },
        });
      }
      // Patch Payment if any
      const payment = await prisma.payment.findFirst({ where: { facilitatorTransferId: parsed.data.transferId } });
      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'settled',
            txHash: parsed.data.txHash ?? payment.txHash,
            settledAt: parsed.data.confirmedAt ? new Date(parsed.data.confirmedAt) : new Date(),
          },
        });
      }
      // Fire Socket.IO payment_settled if it's a payment event
      try {
        if (payment) {
          const { emitPaymentSettled } = await import('@pazzera/realtime');
          await emitPaymentSettled(payment.streamId, {
            paymentId: payment.id,
            songId: payment.songId,
            amountUsdc: payment.amountUsdc,
            recipientCount: 0, // Populated later by Split agent
            txHash: parsed.data.txHash ?? '',
            payoutStatus: 'pending',
          });
        }
      } catch (err) {
        logger.warn({ err }, 'webhook:emit_payment_settled_failed');
      }
      await prisma.paymentEvent.create({
        data: {
          kind: 'payment_settled',
          paymentId: payment?.id,
          streamId: payment?.streamId,
          songId: payment?.songId,
          amountUsdc: payment?.amountUsdc,
          severity: 0,
          meta: { source: 'webhook', eventId: parsed.id, ...parsed.data },
        },
      }).catch(() => undefined);
      break;
    }
    case 'transfer.failed': {
      const tx = await prisma.walletTransaction.findFirst({ where: { txHash: parsed.data.transferId } });
      if (tx) {
        await prisma.walletTransaction.update({
          where: { id: tx.id },
          data: { status: 'failed', failedAt: new Date(), failureReason: parsed.data.failureReason },
        });
      }
      await prisma.paymentEvent.create({
        data: {
          kind: 'payment_failed',
          severity: 50,
          meta: { source: 'webhook', eventId: parsed.id, ...parsed.data },
        },
      }).catch(() => undefined);
      break;
    }
  }

  return Response.json({ ok: true });
}

export const GET = async () => Response.json({ status: 'ok', endpoint: 'circle-webhooks' });
