import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/realtime-pure.test.ts', 'tests/event-bridge.test.ts'],
    globals: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: [
      // Stub out packages that shouldn't be in a realtime unit test.
      { find: /^next\/server$/, replacement: new URL('./tests/_stub-next-server.ts', import.meta.url).pathname },
      { find: /^resend$/, replacement: new URL('./tests/_stub-resend.ts', import.meta.url).pathname },
    ],
  },
});
