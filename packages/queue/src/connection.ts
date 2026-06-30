/**
 * Shared ioredis connection for BullMQ.
 *
 * Returns the underlying `Redis` instance, but at the boundary we cast to
 * BullMQ's `ConnectionOptions` so workers / queues can pass it directly
 * without `as any` at every call site.
 */
import IORedis, { type Redis } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { getEnv, logger } from '@pazzera/core';

let connection: Redis | null = null;

export function getQueueConnection(): ConnectionOptions {
  if (connection) return connection as unknown as ConnectionOptions;
  const env = getEnv();
  connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  connection.on('error', (err: Error) => logger.error({ err }, 'redis:error'));
  connection.on('ready', () => logger.info('redis:ready'));
  return connection as unknown as ConnectionOptions;
}

export async function closeQueueConnection(): Promise<void> {
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}