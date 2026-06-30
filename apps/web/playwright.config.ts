import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Pazzera end-to-end flows.
 *
 * Tests assume the web app is running at PORT 3000 in demo mode and the
 * realtime socket server is at NEXT_PUBLIC_REALTIME_URL.
 *
 * Tests are written to be runnable in two modes:
 *   1. CI against the live Contabo deployment: WEB_BASE_URL is set
 *      to the production URL.
 *   2. Local dev: pnpm dev + pnpm dev:socket + PLAYWRIGHT_BASE_URL.
 *
 * Strict mode + strict typing preserved across helper modules.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // We're testing client flows; surface long traces when something fails.
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  // Server-startup plumbing is left to the deployment orchestrator in
  // production; locally the `pnpm dev` runner starts both processes.
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: 'pnpm dev',
        cwd: '../../',
        port: 3000,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      testMatch: /mobile\.(spec|test)\.ts/,
    },
  ],
});
