/**
 * Environment variable schema.
 *
 * Validated at boot. The app refuses to start if anything required is missing
 * or malformed. Every other module imports `env` from here — never reads
 * `process.env` directly.
 */
import { z } from 'zod';

// Helper: 32-byte hex string (64 chars)
const hex32 = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, 'must be 64 hex chars (32 bytes)');

// Helper: comma-separated list of trimmed non-empty strings
const csv = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

const numericString = (def?: string) =>
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform((v) => Number(v))
    .pipe(def ? z.number().default(Number(def)) : z.number());

const schema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: numericString('3000'),
  SOCKET_PORT: numericString('3001'),
  APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().min(1),

  // Session / cookies
  SESSION_COOKIE_NAME: z.string().default('sid'),
  SESSION_TTL_SECONDS: numericString('2592000'),
  COOKIE_SECRET: z.string().min(32, 'min 32 chars'),

  // Resend OTP
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
  OTP_TTL_SECONDS: numericString('600'),
  OTP_LENGTH: numericString('6'),
  OTP_RATE_LIMIT_PER_EMAIL_PER_HOUR: numericString('5'),
  OTP_RATE_LIMIT_PER_IP_PER_15MIN: numericString('10'),

  // Security
  WALLET_MASTER_KEY: hex32,
  CSRF_SECRET: z.string().min(32),
  RATE_LIMIT_REDIS_PREFIX: z.string().default('rl:'),
  ALLOWED_ORIGINS: csv,

  // Storage
  STORAGE_PROVIDER: z.enum(['r2', 's3', 'local']).default('r2'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  R2_ENDPOINT: z.string().url().optional(),

  // Arc Testnet
  ARC_RPC_URL: z.string().url(),
  ARC_CHAIN_ID: numericString('5042002'),
  ARC_EXPLORER_URL: z.string().url(),
  USDC_CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/),
  USDC_DECIMALS: numericString('6'),

  // Circle Gateway / x402
  CIRCLE_API_KEY: z.string().min(1),
  CIRCLE_APP_ID: z.string().min(1),
  CIRCLE_GATEWAY_FACILITATOR_URL: z.string().url(),
  X402_NETWORK_ID: z.string().default('eip155:5042002'),
  GATEWAY_WALLET_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/),

  // Agents
  CURATOR_PRICE_MIN_USDC: numericString('0.001'),
  CURATOR_PRICE_MAX_USDC: numericString('0.005'),
  FAN_AGENT_DURATION_THRESHOLD_PCT: numericString('25'),
  SPLIT_DEFAULT_ARTIST_PCT: numericString('70'),
  SPLIT_DEFAULT_FEATURED_PCT: numericString('20'),
  SPLIT_DEFAULT_PRODUCER_PCT: numericString('10'),

  // Wallet (Phase 4)
  PAZZERA_WALLET_PROVIDER: z.enum(['local-dev', 'circle-ucw', 'arc-native']).default('local-dev'),
  WALLET_DAILY_WITHDRAW_CAP_USDC: numericString('1000'),
  WALLET_WITHDRAW_COOLDOWN_SECONDS: numericString('60'),
  WALLET_RECOVERY_COOLDOWN_HOURS: numericString('24'),
  WALLET_X402_DAILY_CAP_USDC: numericString('5'),
  WALLET_X402_PER_STREAM_CAP_USDC: numericString('0.01'),
  INDEXER_BATCH_SIZE: numericString('500'),
  INDEXER_INTERVAL_SECONDS: numericString('15'),

  // Admin
  ADMIN_EMAILS: csv,

  // Observability (optional)
  SENTRY_DSN: z.string().optional(),
});

// Cross-field validation: storage vs. R2 credentials
schema.refine(
  (env) => {
    if (env.STORAGE_PROVIDER === 'r2' || env.STORAGE_PROVIDER === 's3') {
      return Boolean(
        env.R2_ACCOUNT_ID &&
          env.R2_ACCESS_KEY_ID &&
          env.R2_SECRET_ACCESS_KEY &&
          env.R2_BUCKET &&
          env.R2_PUBLIC_BASE_URL &&
          env.R2_ENDPOINT,
      );
    }
    return true;
  },
  {
    message:
      'R2/S3 storage selected but R2_* credentials are incomplete. Set STORAGE_PROVIDER=local for dev without R2.',
    path: ['STORAGE_PROVIDER'],
  },
);

// Cross-field: split percentages must sum to 100
schema.refine(
  (env) => {
    const sum =
      env.SPLIT_DEFAULT_ARTIST_PCT +
      env.SPLIT_DEFAULT_FEATURED_PCT +
      env.SPLIT_DEFAULT_PRODUCER_PCT;
    return sum === 100;
  },
  {
    message:
      'SPLIT_DEFAULT_ARTIST_PCT + SPLIT_DEFAULT_FEATURED_PCT + SPLIT_DEFAULT_PRODUCER_PCT must equal 100',
    path: ['SPLIT_DEFAULT_ARTIST_PCT'],
  },
);

// Cross-field: curator price band
schema.refine(
  (env) =>
    env.CURATOR_PRICE_MIN_USDC <= env.CURATOR_PRICE_MAX_USDC &&
    env.CURATOR_PRICE_MIN_USDC > 0,
  {
    message:
      'CURATOR_PRICE_MIN_USDC must be > 0 and <= CURATOR_PRICE_MAX_USDC',
    path: ['CURATOR_PRICE_MIN_USDC'],
  },
);

export type Env = z.infer<typeof schema>;

/**
 * Parse + validate. Throws `ConfigError` with a human-readable list on failure.
 * Call once at boot from `apps/web/server/runtime.ts`.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test-only: reset the cache so tests can mutate process.env. */
export function __resetEnvForTests(): void {
  cached = null;
}