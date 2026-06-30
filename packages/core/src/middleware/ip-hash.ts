/**
 * IP hashing — never store raw IPs in our DB.
 *
 * We hash with a per-deployment pepper (env.SESSION_COOKIE_SECRET) so that
 * even if the DB leaks, the IPs are not directly recoverable, and the
 * same IP produces the same hash within a deployment (for risk scoring).
 */
import { createHash } from 'node:crypto';
import { getEnv } from '../config/env';

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const env = (() => {
    try {
      return getEnv();
    } catch {
      return null;
    }
  })();
  if (!env) return null;
  return createHash('sha256').update(env.COOKIE_SECRET).update(ip).digest('hex');
}

export function extractIp(req: Request | { headers: Headers }): string | null {
  // Cloudflare sets CF-Connecting-IP; fall back to X-Forwarded-For, then X-Real-IP
  const h = req.headers;
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? null;
  const xri = h.get('x-real-ip');
  return xri ?? null;
}