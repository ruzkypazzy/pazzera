/**
 * Redis-backed rate limiter (token bucket via rate-limiter-flexible).
 *
 * Used by the app layer for OTP, login, and authenticated action limits.
 * Edge (Nginx) handles the heavy lifting for unauthenticated abuse.
 */
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import IORedis from 'ioredis';
import { getEnv } from '../config/env';
import { logger } from '../utils/logger';
import { RateLimitError } from '../utils/errors';

type Limiter = RateLimiterRedis | RateLimiterMemory;

const limiters = new Map<string, Limiter>();

function redisFromEnv(): IORedis {
  const env = getEnv();
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    keyPrefix: `${env.RATE_LIMIT_REDIS_PREFIX}`,
  });
}

export function getLimiter(opts: {
  name: string;
  points: number; // max tokens
  duration: number; // window in seconds
  blockDuration?: number;
}): Limiter {
  const cached = limiters.get(opts.name);
  if (cached) return cached;

  const env = (() => {
    try {
      return getEnv();
    } catch {
      return null;
    }
  })();

  let limiter: Limiter;
  if (env?.REDIS_URL) {
    try {
      const redis = redisFromEnv();
      limiter = new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: opts.name,
        points: opts.points,
        duration: opts.duration,
        blockDuration: opts.blockDuration ?? opts.duration,
      });
    } catch (err) {
      logger.warn({ err, limiter: opts.name }, 'rate-limiter: redis init failed, falling back to memory');
      limiter = new RateLimiterMemory({
        keyPrefix: opts.name,
        points: opts.points,
        duration: opts.duration,
        blockDuration: opts.blockDuration ?? opts.duration,
      });
    }
  } else {
    limiter = new RateLimiterMemory({
      keyPrefix: opts.name,
      points: opts.points,
      duration: opts.duration,
      blockDuration: opts.blockDuration ?? opts.duration,
    });
  }

  limiters.set(opts.name, limiter);
  return limiter;
}

/**
 * Consume one token. Throws `RateLimitError` if exhausted.
 */
export async function consume(opts: {
  name: string;
  key: string;
  points?: number;
}): Promise<void> {
  const limiter = limiters.get(opts.name);
  if (!limiter) {
    throw new Error(`Limiter "${opts.name}" not registered`);
  }
  try {
    await limiter.consume(opts.key, opts.points ?? 1);
  } catch (err: unknown) {
    const e = err as { msBeforeNext?: number; retryAfterSec?: number };
    const retryAfterSec = Math.ceil((e.msBeforeNext ?? 1000) / 1000);
    throw new RateLimitError(retryAfterSec);
  }
}

/** Named limiters used across the app. */
export const Limiters = {
  otpPerEmail: () =>
    getLimiter({
      name: 'otp:email',
      points: getEnv().OTP_RATE_LIMIT_PER_EMAIL_PER_HOUR,
      duration: 60 * 60,
    }),
  otpPerIp: () =>
    getLimiter({
      name: 'otp:ip',
      points: getEnv().OTP_RATE_LIMIT_PER_IP_PER_15MIN,
      duration: 15 * 60,
    }),
  signupPerIp: () =>
    getLimiter({ name: 'signup:ip', points: 3, duration: 60 * 60 }),
  loginPerIp: () =>
    getLimiter({ name: 'login:ip', points: 10, duration: 15 * 60 }),
  streamStartPerUser: () =>
    getLimiter({ name: 'stream:user', points: 5, duration: 60 }),
  apiGlobal: () =>
    getLimiter({ name: 'api:global', points: 600, duration: 60 }),
} as const;