/**
 * Server runtime — boot-time orchestration.
 *
 * Validates env, starts Socket.IO alongside Next.js when running with
 * `node` (custom server). In Next.js standalone mode (production), the
 * socket runs as a separate PM2 process (see
 * packages/realtime/src/standalone.ts) and the workers run as a
 * separate PM2 process (see packages/agents/src/workers/run.ts).
 */
import { logger, getEnv } from '@pazzera/core';

let booted = false;

export async function ensureBooted() {
  if (booted) return;
  booted = true;
  // Validate env eagerly (throws on missing vars)
  getEnv();
  logger.info({ env: process.env.NODE_ENV }, 'runtime:booted');
}

export async function startSocketServer() {
  await ensureBooted();
  const env = getEnv();
  const { startRealtimeServer: start } = await import('@pazzera/realtime');
  await start(Number(env.SOCKET_PORT));
}