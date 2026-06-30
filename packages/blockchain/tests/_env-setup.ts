/**
 * Vitest setup — populate `process.env` with sane defaults required by
 * `@pazzera/core/config/env.ts`. Tests that need precise values should
 * override specific keys in their own beforeAll.
 *
 * Mirrors the full Zod schema declared in `@pazzera/core/config/env.ts`.
 * Adding a new required env var to that schema requires updating this file.
 */

const testEnv: Record<string, string> = {
  // Core
  NODE_ENV: 'test',
  PORT: '3000',
  SOCKET_PORT: '3001',
  APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
  DATABASE_URL: 'file:./dev.test.db',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_COOKIE_NAME: 'pazzera_sess',
  SESSION_TTL_SECONDS: '2592000',
  COOKIE_SECRET: 'test-cookie-secret-min-32-chars-long!',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'noreply@pazzera.test',
  OTP_TTL_SECONDS: '600',
  OTP_LENGTH: '6',
  OTP_RATE_LIMIT_PER_EMAIL_PER_HOUR: '5',
  OTP_RATE_LIMIT_PER_IP_PER_15MIN: '20',
  WALLET_MASTER_KEY: '7f3a9b2e8c1d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
  CSRF_SECRET: 'test-csrf-secret-min-32-chars-long!',
  RATE_LIMIT_REDIS_PREFIX: 'rl:',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  STORAGE_PROVIDER: 'r2',

  // Arc
  ARC_RPC_URL: 'https://rpc.testnet.arc.network',
  ARC_CHAIN_ID: '5042002',
  ARC_EXPLORER_URL: 'https://testnet.arcscan.app',
  USDC_CONTRACT_ADDRESS: '0x3600000000000000000000000000000000000000',
  USDC_DECIMALS: '6',

  // Circle
  CIRCLE_API_KEY: 'test_circle_api_key_xxxxxxxxxxxxxxxx',
  CIRCLE_BASE_URL: 'https://api.circle.com',
  CIRCLE_GATEWAY_FACILITATOR_URL: 'https://gateway-api-testnet.circle.com',

  // Gateway
  GATEWAY_WALLET_ADDRESS: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',

  // Pricing
  CURATOR_PRICE_MIN_USDC: '0.001',
  CURATOR_PRICE_MAX_USDC: '0.005',
  FAN_AGENT_DURATION_THRESHOLD_PCT: '25',
  SPLIT_DEFAULT_ARTIST_PCT: '70',
  SPLIT_DEFAULT_FEATURED_PCT: '20',
  SPLIT_DEFAULT_PRODUCER_PCT: '10',

  // Wallet policy
  PAZZERA_WALLET_PROVIDER: 'local-dev',
  WALLET_DAILY_WITHDRAW_CAP_USDC: '1000',
  WALLET_WITHDRAW_COOLDOWN_SECONDS: '60',
  WALLET_RECOVERY_COOLDOWN_HOURS: '24',
  WALLET_X402_DAILY_CAP_USDC: '5',
  WALLET_X402_PER_STREAM_CAP_USDC: '0.01',

  // Indexer
  INDEXER_BATCH_SIZE: '500',
  INDEXER_INTERVAL_SECONDS: '15',

  // Admin / Demo
  ADMIN_EMAILS: '',
  DEMO_MODE: 'false',
};

for (const [k, v] of Object.entries(testEnv)) {
  process.env[k] ??= v;
}
