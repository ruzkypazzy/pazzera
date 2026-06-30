/**
 * POST /api/auth/verify-otp
 *
 * Body: { email: string, code: string, purpose?: OtpPurpose }
 *
 * On success:
 *   - Creates user if first-time
 *   - Creates a new session (HttpOnly cookie) + CSRF cookie
 *   - Enqueues wallet:provision if new user (non-blocking)
 *   - Sets signup_complete analytics event
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  withApi,
  verifyOtp,
  createSession,
  buildSessionCookie,
  buildCsrfCookie,
  extractIp,
  hashIp,
  recordAuthEvent,
  enqueue,
  getEnv,
  AuthError,
  ValidationError,
  getParsedBody,
  csrfTokenFor,
} from '@pazzera/core';

const Body = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
  purpose: z.enum(['sign_in', 'reset_password', 'wallet_recovery', 'artist_upgrade']).optional(),
});

export const POST = withApi(
  async ({ req }) => {
    const { email, code, purpose } = getParsedBody<z.infer<typeof Body>>(req);
    const ip = extractIp(req);
    const ipHash = hashIp(ip);
    const userAgent = req.headers.get('user-agent');

    const result = await verifyOtp({ email, code, purpose: purpose ?? 'sign_in', ipHash, userAgent });
    if (!result.ok) {
      throw new AuthError(
        result.code === 'too_many_attempts' ? 'AUTH_RATE_LIMITED' : 'AUTH_INVALID',
        result.message,
      );
    }

    // Create session
    const session = await createSession({
      userId: result.userId,
      ipHash,
      userAgent,
    });

    // Set cookies
    const sessionCookie = buildSessionCookie(session.rawToken, session.expiresAt);
    const csrfCookie = buildCsrfCookie(
      csrfTokenFor(session.rawToken),
      session.expiresAt,
    );

    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append(
      'set-cookie',
      `${sessionCookie.name}=${sessionCookie.value}; Path=/; HttpOnly; SameSite=Lax; Expires=${sessionCookie.options.expires.toUTCString()}${getEnv().NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
    headers.append(
      'set-cookie',
      `${csrfCookie.name}=${csrfCookie.value}; Path=/; SameSite=Lax; Expires=${csrfCookie.options.expires.toUTCString()}${getEnv().NODE_ENV === 'production' ? '; Secure' : ''}`,
    );

    // Async wallet provisioning for new users — does NOT block this response
    if (result.isNewUser) {
      await enqueue.walletProvision({ userId: result.userId, attempt: 1 });
      await recordAuthEvent({
        type: 'signup_completed',
        userId: result.userId,
        email,
        ipHash,
        userAgent,
        severity: 0,
        meta: { source: 'otp_verify' },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        userId: result.userId,
        isNewUser: result.isNewUser,
        // Hint to the client that the wallet may still be provisioning
        walletStatus: result.isNewUser ? 'pending_provisioning' : 'unknown',
      }),
      { status: 200, headers },
    );
  },
  { bodySchema: Body },
);