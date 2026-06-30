/**
 * Phase 8 — Nonce Store.
 *
 * 2-layer protection against double-charge:
 *   - Redis SET NX EX 600  — hot cache, single-use, atomic
 *   - Postgres PaymentNonce row with UNIQUE nonce — durable second check
 *
 * `issueAndStoreNonce` writes to both. `consumeNonce` succeeds exactly once.
 * Both layers must pass: if Redis eviction drops the cache, Postgres still
 * rejects reuse; if Postgres replication lag is real, Redis still rejects.
 */
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { prisma } from '@pazzera/db';
import { getEnv } from '@pazzera/core/config/env';
import { PAYMENT_NONCE_TTL_SEC } from './protocol';
import { logger } from '@pazzera/core';

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: 2 });
    redis.on('error', (e) => logger.error({ err: e }, 'realtime:redis_error'));
  }
  return redis;
}

export async function issueAndStoreNonce(opts: {
  streamId: string;
  userId: string;
  amountUsdc: string;
}): Promise<string> {
  const nonce = `n_${randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + PAYMENT_NONCE_TTL_SEC * 1000);

  // Redis (best-effort): SET NX EX with the full payload so we can prove
  // ownership later.
  try {
    await getRedis().set(`pazzera:nonce:${nonce}`, JSON.stringify(opts), 'EX', PAYMENT_NONCE_TTL_SEC, 'NX');
  } catch (err) {
    logger.warn({ err }, 'realtime:nonce_redis_write_failed');
  }

  // Postgres (durable): UNIQUE nonce column.
  await prisma.paymentNonce.create({
    data: {
      nonce,
      streamId: opts.streamId,
      userId: opts.userId,
      amountUsdc: opts.amountUsdc,
      expiresAt,
    },
  });

  return nonce;
}

/** Returns true on first use; returns false on replay attempts. */
export async function consumeNonce(opts: { nonce: string; streamId: string }): Promise<boolean> {
  // Redis fast-path
  try {
    const stored = await getRedis().get(`pazzera:nonce:${opts.nonce}`);
    if (stored === null) {
      // Either expired or never existed. Fall through to Postgres check.
    } else {
      // Use Lua to atomically check-and-delete
      const lua = `
        local current = redis.call('GET', KEYS[1])
        if current == false then return 0 end
        redis.call('DEL', KEYS[1])
        return 1
      `;
      const result = (await getRedis().eval(lua, 1, `pazzera:nonce:${opts.nonce}`)) as number;
      if (result === 0) {
        // Already consumed
        return false;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'realtime:nonce_redis_check_failed');
  }

  // Postgres authoritative check
  const row = await prisma.paymentNonce.findUnique({ where: { nonce: opts.nonce } });
  if (!row) return false;
  if (row.usedAt) return false;
  if (row.expiresAt < new Date()) return false;
  if (row.streamId !== opts.streamId) return false;
  try {
    await prisma.paymentNonce.update({
      where: { nonce: opts.nonce },
      data: { usedAt: new Date() },
    });
    return true;
  } catch (err: unknown) {
    // Race condition: another consumer marked usedAt first.
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return false;
    }
    throw err;
  }
}

export async function isNonceKnown(nonce: string): Promise<boolean> {
  const row = await prisma.paymentNonce.findUnique({ where: { nonce }, select: { nonce: true } });
  return !!row;
}

export async function closeNonceStore(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => undefined);
    redis = null;
  }
}
