/**
 * Rate limiting middleware — protects auth endpoints from brute force,
 * signup spam, password reset flooding.
 *
 * Strategy: in-memory sliding window counter keyed by IP + endpoint.
 * For multi-instance deployments, swap with Redis-backed implementation.
 */
import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

interface RateLimitConfig {
  windowMs: number;       // time window in ms
  maxRequests: number;    // max requests per window
  blockMs?: number;       // how long to block after exceeding (default: windowMs)
}

export function rateLimit(config: RateLimitConfig) {
  const { windowMs, maxRequests, blockMs = windowMs } = config;
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStart > windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      return next();
    }

    bucket.count++;

    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil(blockMs / 1000));
      return res.status(429).json({
        error: 'rate limit exceeded',
        retryAfterSeconds: Math.ceil(blockMs / 1000),
      });
    }

    next();
  };
}

// Periodic cleanup of expired buckets (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets.entries()) {
    if (now - b.windowStart > 600_000) buckets.delete(key);
  }
}, 300_000).unref();

// Pre-configured limiters for common auth endpoints
export const authLimiters = {
  signup: rateLimit({ windowMs: 60 * 60_000, maxRequests: 5 }),     // 5/hour/IP
  login: rateLimit({ windowMs: 15 * 60_000, maxRequests: 10 }),    // 10/15min/IP
  forgotPassword: rateLimit({ windowMs: 60 * 60_000, maxRequests: 3 }),
  verifyEmail: rateLimit({ windowMs: 60 * 60_000, maxRequests: 10 }),
  general: rateLimit({ windowMs: 60_000, maxRequests: 120 }),      // 2/sec average
};

/**
 * Reset all rate limit buckets. Used in test setup.
 */
export function resetRateLimits() {
  buckets.clear();
}