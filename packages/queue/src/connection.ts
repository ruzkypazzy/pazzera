/**
 * Shared ioredis connection for BullMQ.
 */
import IORedis, { type Redis } from 'ioredis';
import { getEnv, logger } from '@pazzera/core';

let connection: Redis | null = null;

export function getQueueConnection(): Redis {
  if (connection) return connection;
  const env = getEnv();
  connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  connection.on('error', (err) => logger.error({ err }, 'redis:error'));
  connection.on('ready', () => logger.info('redis:ready'));
  return connection;
}

export async function closeQueueConnection(): Promise<void> {
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}