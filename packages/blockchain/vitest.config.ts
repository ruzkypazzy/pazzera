import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/phase9-payment.test.ts', 'tests/x402.test.ts'],
    globals: false,
    testTimeout: 30000,
    setupFiles: ['./tests/_env-setup.ts'],
  },
  resolve: {
    alias: [
      { find: /^next\/server$/, replacement: new URL('./tests/_stub-next-server.ts', import.meta.url).pathname },
      { find: /^@pazzera\/core$/, replacement: path.join(repoRoot, 'packages/core/src/index.ts') },
      { find: /^@pazzera\/core\/(.*)$/, replacement: path.join(repoRoot, 'packages/core/src/$1') },
      { find: /^@pazzera\/db$/, replacement: path.join(repoRoot, 'packages/db/src/index.ts') },
      { find: /^@pazzera\/db\/(.*)$/, replacement: path.join(repoRoot, 'packages/db/src/$1') },
      { find: /^@pazzera\/queue$/, replacement: path.join(repoRoot, 'packages/queue/src/index.ts') },
      { find: /^@pazzera\/queue\/(.*)$/, replacement: path.join(repoRoot, 'packages/queue/src/$1') },
      { find: /^@pazzera\/realtime$/, replacement: path.join(repoRoot, 'packages/realtime/src/index.ts') },
      { find: /^@pazzera\/realtime\/(.*)$/, replacement: path.join(repoRoot, 'packages/realtime/src/$1') },
      { find: /^resend$/, replacement: new URL('./tests/_stub-resend.ts', import.meta.url).pathname },
    ],
  },
});
