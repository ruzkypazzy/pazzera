/**
 * Email + password authentication for the application layer.
 *
 * Sessions are JWTs stored in an httpOnly cookie. The session identifies
 * the application user (our users table). The user's Circle wallet is
 * looked up separately via the wallets table.
 *
 * Password hashing: bcryptjs (cost factor 12 — balanced for Node 20).
 * JWT: HS256, 7-day expiry, signed with JWT_SECRET.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const SECRET = process.env.JWT_SECRET ?? 'change-me-in-prod-please-this-is-not-secure';
const COOKIE_NAME = 'pazzera_session';
const SESSION_DAYS = 7;

export interface SessionPayload {
  userId: string;
  email: string;
  role: 'fan' | 'artist';
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Express middleware: requires a valid session JWT in the cookie.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = token ? verifySession(token) : null;
  if (!session) return res.status(401).json({ error: 'authentication required' });
  (req as any).session = session;
  next();
}

// Soft auth: populates req.session if present, doesn't fail if absent.
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = token ? verifySession(token) : null;
  if (session) (req as any).session = session;
  next();
}