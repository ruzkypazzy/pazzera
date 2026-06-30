/**
 * Session helpers — used by API routes that need an authenticated user.
 *
 * The cookie is parsed by the Next route handler using next/server's
 * `cookies()` function, which is platform-aware. For the @pazzera/core
 * stub layer, we provide minimal type shapes; the real session lookup
 * happens in `@pazzera/core/services/session-service` once invoked from
 * a Next context.
 */
export interface SessionUser {
  id: string;
  userId: string;
  username: string;
  isArtist?: boolean;
  email?: string | null;
  roles?: string[];
}

/**
 * Stub that throws in non-Next contexts. Real route handlers must call
 * `requireSessionFromCookies` (defined in @pazzera/web helper layer).
 */
export async function requireSession(): Promise<SessionUser> {
  throw new Error(
    'requireSession called without a Next request context. Use the web-app helper that reads cookies().',
  );
}

/**
 * Role guard — stub at the core layer; the real check lives in the web
 * app (next to the cookie reading code).
 */
export async function requireRole(_roles: string[]): Promise<SessionUser> {
  throw new Error(
    'requireRole called without a Next request context.',
  );
}

