/**
 * POST /api/auth/logout
 *
 * Revokes the current session only. Idempotent.
 */
import {
  withApi,
  revokeSession,
  clearSessionCookie,
  getCurrentSession,
  AuthError,
} from '@pazzera/core';

export const POST = withApi(
  async () => {
    const session = await getCurrentSession();
    if (!session) {
      // already logged out; no-op
      const cookie = clearSessionCookie();
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': `${cookie.name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        },
      });
    }
    await revokeSession(session.id, 'logout');
    const cookie = clearSessionCookie();
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': `${cookie.name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      },
    });
  },
  { requireAuth: false, requireCsrf: false },
);