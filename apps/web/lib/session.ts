/**
 * Server-side helper to read the current session.
 *
 * Works in:
 *   - Server components (via next/headers cookies())
 *   - Route handlers (via req.cookies)
 *   - Server actions (via next/headers cookies())
 */
import { cookies } from 'next/headers';
import { validateSession, type ValidatedSession, getEnv } from '@pazzera/core';

export async function getCurrentSession(): Promise<ValidatedSession | null> {
  const env = getEnv();
  const store = await cookies();
  const token = store.get(env.SESSION_COOKIE_NAME)?.value;
  return validateSession(token, { touch: true });
}

export async function requireSession(): Promise<ValidatedSession> {
  const s = await getCurrentSession();
  if (!s) {
    const { AuthError } = await import('@pazzera/core');
    throw new AuthError('AUTH_REQUIRED');
  }
  return s;
}