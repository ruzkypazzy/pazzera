/**
 * Integration test: full auth flow.
 *
 *   request-otp → email enqueued for delivery
 *   verify-otp  → user created (or matched), session row written, cookie set
 *   /api/auth/session → returns the authenticated user
 *
 * Requires:
 *   - DATABASE_URL pointing at a real Postgres
 *   - REDIS_URL pointing at a real Redis
 *   - All other env vars from .env.example
 *
 * Email sending is monkey-patched via vi.mock so no Resend key is needed.
 *
 * The test cleans up after itself (deletes the created user + sessions).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Capture OTP codes the app would otherwise email out
let capturedCode: string | null = null;
let capturedEmail: string | null = null;

vi.mock('@pazzera/core/services/email-service', async () => {
  const actual = await vi.importActual<typeof import('@pazzera/core/services/email-service')>(
    '@pazzera/core/services/email-service',
  );
  return {
    ...actual,
    sendOtpEmail: async (input: { to: string; code: string }) => {
      capturedEmail = input.to;
      capturedCode = input.code;
      return { delivered: true, provider: 'console' as const };
    },
  };
});

// Imports happen AFTER the mock is registered
const { POST: requestOtp } = await import('@/app/api/auth/request-otp/route');
const { POST: verifyOtp } = await import('@/app/api/auth/verify-otp/route');
const { GET: getSession } = await import('@/app/api/auth/session/route');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const TEST_EMAIL = `test-${Date.now()}@pazzera-integration.test`;

function makeReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

describe('auth flow: request-otp → verify-otp → session', () => {
  beforeAll(() => {
    capturedCode = null;
    capturedEmail = null;
  });

  afterAll(async () => {
    // Best-effort cleanup
    try {
      await prisma.session.deleteMany({ where: { user: { email: TEST_EMAIL } } });
      await prisma.otpCode.deleteMany({ where: { email: TEST_EMAIL } });
      await prisma.wallet.deleteMany({ where: { user: { email: TEST_EMAIL } } });
      await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    } catch {
      // ignore
    } finally {
      await prisma.$disconnect();
    }
  });

  it('completes the full sign-in flow for a new email', async () => {
    // 1. Request OTP
    const reqReq = makeReq('http://localhost:3000/api/auth/request-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL }),
    });
    const reqRes = await requestOtp(reqReq, { params: {} });
    expect(reqRes.status).toBe(200);
    expect(capturedEmail).toBe(TEST_EMAIL);
    expect(capturedCode).toMatch(/^\d{6}$/);
    const code = capturedCode!;

    // 2. Verify OTP — should create the user + session
    const verReq = makeReq('http://localhost:3000/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, code }),
    });
    const verRes = await verifyOtp(verReq, { params: {} });
    expect(verRes.status).toBe(200);
    const setCookie = verRes.headers.get('set-cookie');
    expect(setCookie).toMatch(/sid=/);
    const verJson = await verRes.json();
    expect(verJson.isNewUser).toBe(true);
    expect(verJson.userId).toBeTruthy();
    expect(verJson.walletStatus).toBe('pending_provisioning');

    // 3. User row exists with a valid username
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user).not.toBeNull();
    expect(user?.username).toMatch(/^[a-z][a-z0-9_]{1,18}[a-z0-9]$/);

    // 4. Session row exists, unrevoked, with both expiry fields set
    const sessions = await prisma.session.findMany({
      where: { userId: user!.id, revokedAt: null },
    });
    expect(sessions.length).toBe(1);
    const session = sessions[0]!;
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(session.inactivityExpiresAt.getTime()).toBeGreaterThan(Date.now());

    // 5. /api/auth/session with the cookie should return the user
    const cookieValue = /sid=([^;]+)/.exec(setCookie!)?.[1] ?? '';
    const sessionReq = makeReq('http://localhost:3000/api/auth/session', {
      headers: { cookie: `sid=${cookieValue}` },
    });
    const sessionRes = await getSession(sessionReq, { params: {} });
    expect(sessionRes.status).toBe(200);
    const sessionJson = await sessionRes.json();
    expect(sessionJson.authenticated).toBe(true);
    expect(sessionJson.user.email).toBe(TEST_EMAIL);
  });

  it('rejects an invalid OTP code', async () => {
    const verReq = makeReq('http://localhost:3000/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, code: '000000' }),
    });
    const verRes = await verifyOtp(verReq, { params: {} });
    expect(verRes.status).toBe(401);
  });

  it('blocks disposable email domains', async () => {
    const reqReq = makeReq('http://localhost:3000/api/auth/request-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'trash@mailinator.com' }),
    });
    const reqRes = await requestOtp(reqReq, { params: {} });
    expect(reqRes.status).toBe(400);
  });
});