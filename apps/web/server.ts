/**
 * Custom Next.js server for Pazzera.
 *
 * Boots Next.js HTTP server on PORT (default 3000) AND attaches the
 * Socket.IO realtime server to the SAME HTTP server. This lets
 * nginx (which already terminates TLS for pazzera.com and proxies
 * all paths to port 3000) route both the Next.js app and the
 * /socket.io/ websocket through a single origin.
 *
 * In Next 14 standalone mode the generated server.js is replaced
 * by this one (Dockerfile.web copies in `server.ts` and runs it
 * via `tsx`).
 */
import { createServer } from 'node:http';
import next from 'next';
import { logger, getEnv } from '@pazzera/core';

async function main() {
  getEnv(); // validate env eagerly
  const dev = false;
  const hostname = '0.0.0.0';
  const port = Number(process.env.PORT ?? 3000);

  // next-standalone places .next under apps/web/.next. cwd may be
  // /app, so resolve it explicitly.
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const appsWebDir = path.resolve(here);

  const app = next({ dev, hostname, port, dir: appsWebDir });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  // Boot the realtime Socket.IO server onto the same HTTP server so
  // /socket.io/ is served from the same origin as the Next.js app.
  const { startRealtimeServer } = await import('@pazzera/realtime');
  // startRealtimeServer accepts an http.Server and binds Socket.IO to it.
  await startRealtimeServer(httpServer, Number(process.env.SOCKET_PORT ?? 3001));

  httpServer.listen(port, hostname, () => {
    logger.info({ port }, 'web:listening');
  });
}

main().catch((err) => {
  logger.error({ err }, 'web:start_failed');
  process.exit(1);
});
