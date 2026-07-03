/**
 * Session service.
 *
 * Rules (per Phase 3 spec):
 *   - sessionId: random 32 bytes (opaque token)
 *   - userId
 *   - issuedAt, expiresAt (30d TTL), lastSeenAt
 *   - inactivityExpiresAt (14d from lastSeenAt; refreshed each request)
 *   - deviceFingerprint (optional)
 *   - ipHash (raw IP never stored)
 *   - revokedAt + revokedReason
 *   - HttpOnly, Secure, SameSite=Lax cookie
 *   - Cookie value = sessionId; DB stores SHA-256(sessionId) as sessionTokenHash
 *
 * Logout = revoke current session only.
 * Admin revoke all = revoke every Session where userId = X and revokedAt is null.
 */
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@pazzera/db';
import { logger, getEnv } from '../index';
import { recordAuthEvent } from './auth-events';

const SESSION_TTL_DAYS = 30;
const SESSION_INACTIVITY_DAYS = 14;

function newSessionId(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function hashSessionId(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface CreateSessionInput {
  userId: string;
  ipHash?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  /** Optional mark — if true, the user explicitly opted to remember the device. */
  remember?: boolean;
}

export interface SessionRecord {
  id: string;
  userId: string;
  rawToken: string; // only present on create
  expiresAt: Date;
}

export async function createSession(input: CreateSessionInput): Promise<SessionRecord> {
  const { raw, hash } = newSessionId();
  const csrf = randomBytes(24).toString('base64url');
  const env = getEnv();
  const ttlSeconds = input.remember ? env.SESSION_TTL_SECONDS : env.SESSION_TTL_SECONDS;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
  const inactivityExpiresAt = new Date(
    issuedAt.getTime() + SESSION_INACTIVITY_DAYS * 24 * 60 * 60 * 1000,
  );

  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      sessionTokenHash: hash,
      csrfToken: csrf,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
      deviceFingerprint: input.deviceFingerprint ?? null,
      issuedAt,
      expiresAt,
      lastSeenAt: issuedAt,
      inactivityExpiresAt,
    },
    select: { id: true, userId: true, expiresAt: true },
  });

  await recordAuthEvent({
    type: 'session_created',
    userId: input.userId,
    ipHash: input.ipHash,
    userAgent: input.userAgent,
  });

  logger.info({ userId: input.userId, sessionId: session.id }, 'session:created');
  return { id: session.id, userId: session.userId, rawToken: raw, expiresAt: session.expiresAt };
}

export interface ValidatedSession {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
  inactivityExpiresAt: Date;
}

export async function validateSession(
  rawToken: string | null | undefined,
  opts: { touch?: boolean } = {},
): Promise<ValidatedSession | null> {
  if (!rawToken) return null;
  const hash = hashSessionId(rawToken);
  const session = await prisma.session.findUnique({
    where: { sessionTokenHash: hash },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  const now = new Date();
  if (session.expiresAt < now) return null;
  if (session.inactivityExpiresAt < now) return null;

  if (opts.touch) {
    // Refresh lastSeenAt + sliding inactivity window (14d from now)
    await prisma.session.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        inactivityExpiresAt: new Date(now.getTime() + SESSION_INACTIVITY_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  }

  return {
    id: session.id,
    userId: session.userId,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    inactivityExpiresAt: session.inactivityExpiresAt,
  };
}

/**
 * Read the current session token from a cookie header. Pure helper — the
 * Next route handler is expected to pass `cookieHeader`. Returns the raw
 * token (un-hashed) so callers can feed it into validateSession.
 */
export function readSessionFromCookies(cookieHeader: string | null | undefined, cookieName = 'sid'): string | null {
  if (!cookieHeader) return null;
  for (const piece of cookieHeader.split(';')) {
    const [k, ...rest] = piece.trim().split('=');
    if (k === cookieName) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Convenience: read + validate the current session if one exists.
 * Returns `null` when there is no valid session.
 */
export async function getCurrentSession(opts: { cookieHeader?: string | null } = {}): Promise<ValidatedSession | null> {
  const token = readSessionFromCookies(opts.cookieHeader ?? null);
  return validateSession(token, { touch: true });
}

export async function revokeSession(
  sessionId: string,
  reason: 'logout' | 'admin_revoke' | 'password_reset' | 'suspicion' = 'logout',
): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await recordAuthEvent({ type: 'session_revoked', meta: { sessionId, reason } });
  logger.info({ sessionId, reason }, 'session:revoked');
}

export async function revokeAllForUser(
  userId: string,
  reason: 'admin_revoke' | 'password_reset' | 'suspicion' = 'admin_revoke',
  exceptSessionId?: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await recordAuthEvent({
    type: 'session_revoked',
    userId,
    meta: { count: result.count, reason, scope: 'all' },
  });
  logger.info({ userId, count: result.count, reason }, 'session:revoked_all');
  return result.count;
}

// ─── Cookie helpers ──────────────────────────────────────────────────

export function buildSessionCookie(token: string, expiresAt: Date): {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict';
    path: string;
    expires: Date;
  };
} {
  const env = getEnv();
  return {
    name: env.SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    },
  };
}

export function clearSessionCookie(): { name: string; value: string; options: object } {
  const env = getEnv();
  return {
    name: env.SESSION_COOKIE_NAME,
    value: '',
    options: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0,
    },
  };
}

export function buildCsrfCookie(csrfToken: string, expiresAt: Date) {
  const env = getEnv();
  return {
    name: 'csrf',
    value: csrfToken,
    options: {
      httpOnly: false, // client-readable for double-submit
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      expires: expiresAt,
    },
  };
}

export const SESSION_TTL_DAYS_CONST = SESSION_TTL_DAYS;
export const SESSION_INACTIVITY_DAYS_CONST = SESSION_INACTIVITY_DAYS;