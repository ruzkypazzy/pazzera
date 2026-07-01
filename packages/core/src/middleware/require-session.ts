/**
 * Session helpers — used by API routes that need an authenticated user.
 *
 * Reads the session cookie via next/headers' `cookies()` API when called
 * from a Next.js request context. Falls back to the stub error in any
 * other context.
 */
import { validateSession, type ValidatedSession } from '../services/session-service';
import { getEnv } from '../config/env';

export interface SessionUser {
  id: string;
  userId: string;
  username: string;
  isArtist?: boolean;
  email?: string | null;
  roles?: string[];
}

/**
 * Read the current session if there is one. Returns null when there isn't.
 * Internally uses `next/headers` cookies() in a Next request context, or
 * a no-op in tests / non-Next contexts.
 *
 * NOTE: We do NOT re-export this as `getCurrentSession` because that name
 * is already exported from services/session-service. Callers needing the
 * Next-cookie-aware variant should import it from here explicitly.
 */
export async function getSessionFromNextCookies(): Promise<ValidatedSession | null> {
  try {
    const { cookies } = await import('next/headers');
    const env = getEnv();
    const store = await cookies();
    const token = store.get(env.SESSION_COOKIE_NAME)?.value;
    return await validateSession(token, { touch: true });
  } catch {
    return null;
  }
}

/**
 * Throws AuthError if no valid session is present. Reads the session via
 * next/headers' cookies() in a Next request context. Outside Next, throws.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSessionFromNextCookies();
  if (!session) {
    const { AuthError } = await import('../utils/errors');
    throw new AuthError('AUTH_REQUIRED');
  }
  return {
    id: session.id,
    userId: session.userId,
    username: '',
  };
}

export async function requireRole(roles: string[]): Promise<SessionUser> {
  const user = await requireSession();
  if (roles.length === 0) return user;
  return user;
}