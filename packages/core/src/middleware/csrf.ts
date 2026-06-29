/**
 * CSRF: double-submit cookie pattern.
 *
 * On session mint, we set two cookies:
 *   sid     — HttpOnly, the actual session
 *   csrf    — NOT HttpOnly, readable by JS, contains HMAC(COOKIE_SECRET, sid)
 *
 * Mutating requests must echo the csrf value in `x-csrf-token` header.
 * Server recomputes HMAC and compares.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getEnv } from '../config/env';

function sign(value: string): string {
  const env = getEnv();
  return createHmac('sha256', env.COOKIE_SECRET).update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function csrfTokenFor(sessionId: string): string {
  return sign(sessionId);
}

export async function verifyCsrf(req: NextRequest): Promise<boolean> {
  const env = getEnv();
  const sid = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const headerToken = req.headers.get('x-csrf-token');
  const cookieToken = req.cookies.get('csrf')?.value;

  if (!sid || !headerToken) return false;

  // Either header token or cookie token (they should match) must equal HMAC(sid)
  const expected = sign(sid);
  const headerOk = safeEqual(expected, headerToken);
  const cookieOk = cookieToken ? safeEqual(expected, cookieToken) : false;

  return headerOk && cookieOk;
}

export function csrfCookieAttributes(): {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict';
    path: string;
    maxAge: number;
  };
} {
  const env = getEnv();
  return {
    name: 'csrf',
    value: '', // set per-session
    options: {
      httpOnly: false,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: env.SESSION_TTL_SECONDS,
    },
  };
}