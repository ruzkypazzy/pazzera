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

export type Logger = typeof logger;