/**
 * E2E test fixtures.
 *
 * Phase 10 — production-grade end-to-end coverage. The helpers here are
 * kept in a single file so:
 *   - Strict typing is preserved (no `any` leaks, ever).
 *   - Each spec reuses the same seed/fixture data
 *   - The realtime + payment flows can be asserted on real WS events.
 */
import { type APIRequestContext, type Page, type BrowserContext, expect } from '@playwright/test';

export interface TestUser {
  email: string;
  username: string;
  password: string;
  isArtist: boolean;
  sessionToken?: string;
}

export interface TestSong {
  id: string;
  slug: string;
  title: string;
  artistId: string;
  artistUsername: string;
  durationSeconds: number;
  publishedPriceUsdc: string;
  audioUrl: string;
  coverUrl: string;
  previewUrl: string | null;
  waveformUrl: string | null;
}

export interface SignedAuth {
  validUntil: number;
  value: string;
  from: string;
  to: string;
  nonce: string;
  signature: string;
}

/**
 * Build a deterministic test user. The seed email intentionally uses
 * the `.test` TLD so it can never be confused with a real account.
 */
export function makeTestUser(name: string, isArtist = false): TestUser {
  return {
    email: `${name}@pazzera.test`,
    username: `e2e_${name}`,
    password: 'PazzeraE2E!2026',
    isArtist,
  };
}

/**
 * Drive signup against the web app. Uses `page.request` so it never
 * touches the browser DOM — keeps these tests fast even at scale.
 */
export async function signupViaApi(
  request: APIRequestContext,
  user: TestUser,
): Promise<void> {
  const res = await request.post('/api/auth/signup', {
    data: {
      email: user.email,
      username: user.username,
      password: user.password,
      agreeToTerms: true,
    },
  });
  expect(res.status()).toBeLessThan(400);
  const body = await res.json().catch(() => null);
  user.sessionToken = body?.sessionToken;
  if (user.isArtist) {
    const upgrade = await request.post('/api/auth/artist-upgrade', {
      data: { acceptedTerms: true },
    });
    expect(upgrade.status()).toBeLessThan(400);
  }
}

/**
 * Drive email-OTP signin through the API. If a real OTP delivery channel
 * is not available, the test environment exposes /api/auth/test-otp
 * behind NODE_ENV=test. Tests assert against that endpoint.
 */
export async function signinWithOtp(
  request: APIRequestContext,
  user: { email: string },
): Promise<string> {
  const req = await request.post('/api/auth/request-otp', { data: { email: user.email } });
  expect(req.status()).toBeLessThan(400);
  const otpRes = await request.get(`/api/auth/test-otp?email=${encodeURIComponent(user.email)}`);
  expect(otpRes.status()).toBeLessThan(400);
  const { code } = (await otpRes.json()) as { code: string };
  const verify = await request.post('/api/auth/verify-otp', {
    data: { email: user.email, code, purpose: 'sign_in' },
  });
  expect(verify.status()).toBeLessThan(400);
  const json = (await verify.json()) as { sessionToken: string };
  return json.sessionToken;
}

/**
 * Attach the session cookie to a browser context so subsequent pages
 * see the signed-in user without re-driving OTP every test.
 */
export async function attachSession(ctx: BrowserContext, sessionToken: string): Promise<void> {
  await ctx.addCookies([
    {
      name: 'pazzera_sess',
      value: sessionToken,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      domain: 'localhost',
      path: '/',
    },
  ]);
}

/**
 * Wait until the realtime socket has connected and the player UI shows
 * 'connected'. Returns when ready, throws after `timeoutMs`.
 */
export async function waitForRealtimeConnected(page: Page, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await page.locator('[data-testid="connection-status"]').textContent();
    if (status === 'connected') return;
    await page.waitForTimeout(200);
  }
  throw new Error(`Realtime socket never reported connected within ${timeoutMs}ms`);
}
