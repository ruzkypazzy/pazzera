/**
 * Standalone Socket.IO server entrypoint.
 *
 * Runs as its own Node process (PM2-managed on the host, separate from
 * the BullMQ workers) and listens for the realtime stream + payment
 * socket events. Binds to the configured SOCKET_PORT (default 3001).
 *
 * Started with:
 *   tsx packages/realtime/src/standalone.ts
 *   # or via @pazzera/realtime's package.json "socket:start"
 */
import { logger } from '@pazzera/core';
import { startRealtimeServer } from './server';

async function main() {
  const port = Number(process.env.SOCKET_PORT ?? 3001);
  logger.info({ port }, 'realtime:starting');
  await startRealtimeServer(port);
  logger.info({ port }, 'realtime:ready');

  process.on('SIGTERM', () => {
    logger.info('realtime:sigterm');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    logger.info('realtime:sigint');
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, 'realtime:start_failed');
  process.exit(1);
});
