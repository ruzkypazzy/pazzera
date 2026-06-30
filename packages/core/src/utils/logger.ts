/**
 * Structured JSON logger with secret redaction.
 *
 * Usage:
 *   import { logger } from '@pazzera/core/utils/logger';
 *   logger.info({ userId, action: 'otp.requested' }, 'OTP requested');
 */
import pino from 'pino';
import { getEnv } from '../config/env';

const REDACT_PATHS = [
  '*.password',
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.privateKey',
  '*.private_key',
  '*.seed',
  '*.mnemonic',
  '*.otp',
  '*.code',
  '*.authorization',
  '*.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

function createLogger() {
  const env = (() => {
    try {
      return getEnv();
    } catch {
      return null;
    }
  })();

  const level = env?.LOG_LEVEL ?? 'info';
  const isDev = env?.NODE_ENV === 'development';

  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'pazzera' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  });
}

export const logger = createLogger();

/**
 * Phase 10 — set additional persistent bindings on the logger. Used by
 * request middleware to attach a `requestId` so every downstream log
 * emitted during the request lifetime carries the correlation id.
 */
export function setBindings(bindings: Record<string, unknown>): void {
  // `pino.child` is the canonical way to attach request-scoped bindings;
  // we leverage the existing logger by reassigning through the same
  // API surface (callers should re-import).
  try {
    logger.setBindings?.(bindings);
  } catch {
    // older pino versions don't expose setBindings; fall through to no-op.
  }
}

/** Phase 10 — read-only access to the current bindings (for SSR). */
export function bindings(): Record<string, unknown> {
  return (logger as unknown as { bindings?: () => Record<string, unknown> }).bindings?.() ?? {};
}

export type Logger = typeof logger;