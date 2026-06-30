import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: [
      // `next/server` is bundled by the web app; we expose a tiny stub
      // so the upload pipeline's typecheck-time dependency on core's
      // middleware compiles for unit tests.
      { find: /^next\/server$/, replacement: new URL('./tests/_stub-next-server.ts', import.meta.url).pathname },
      { find: /^@pazzera\/core$/, replacement: path.join(repoRoot, 'packages/core/src/index.ts') },
      { find: /^@pazzera\/core\/(.*)$/, replacement: path.join(repoRoot, 'packages/core/src/$1') },
      { find: /^@pazzera\/db$/, replacement: path.join(repoRoot, 'packages/db/src/index.ts') },
      { find: /^@pazzera\/db\/(.*)$/, replacement: path.join(repoRoot, 'packages/db/src/$1') },
      { find: /^@pazzera\/queue$/, replacement: path.join(repoRoot, 'packages/queue/src/index.ts') },
      { find: /^@pazzera\/queue\/(.*)$/, replacement: path.join(repoRoot, 'packages/queue/src/$1') },
      { find: /^@pazzera\/realtime$/, replacement: path.join(repoRoot, 'packages/realtime/src/index.ts') },
      { find: /^@pazzera\/realtime\/(.*)$/, replacement: path.join(repoRoot, 'packages/realtime/src/$1') },
      { find: /^@pazzera\/storage$/, replacement: path.join(repoRoot, 'packages/storage/src/index.ts') },
      { find: /^@pazzera\/storage\/(.*)$/, replacement: path.join(repoRoot, 'packages/storage/src/$1') },
      { find: /^@pazzera\/blockchain$/, replacement: path.join(repoRoot, 'packages/blockchain/src/index.ts') },
      { find: /^@pazzera\/blockchain\/(.*)$/, replacement: path.join(repoRoot, 'packages/blockchain/src/$1') },
      { find: /^resend$/, replacement: new URL('./tests/_stub-resend.ts', import.meta.url).pathname },
    ],
  },
});
