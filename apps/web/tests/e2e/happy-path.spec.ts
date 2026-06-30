/**
 * E2E happy path — sign in, discover a song, hit the 25% threshold,
 * complete the x402 payment round trip.
 *
 * Mocks the realtime socket via the /api/realtime/test-payload channel
 * when needed; otherwise relies on the live server.
 */
import { test, expect } from '@playwright/test';
import { makeTestUser, signupViaApi, signinWithOtp, attachSession, waitForRealtimeConnected } from './fixtures';

test.describe('Pazzera happy path', () => {
  test('anonymous visitor lands on marketing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /pazzera/i })).toBeVisible({ timeout: 15_000 });
  });

  test('sign-in via email OTP issues a session and lands on the dashboard', async ({ page, request }) => {
    const user = makeTestUser('happy_signin');
    await signupViaApi(request, user);
    const token = await signinWithOtp(request, user);
    await attachSession(page.context(), token);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('user-greeting')).toBeVisible({ timeout: 15_000 });
  });

  test('dashboard surfaces trending + recommended songs', async ({ page, request }) => {
    const user = makeTestUser('happy_dashboard');
    await signupViaApi(request, user);
    const token = await signinWithOtp(request, user);
    await attachSession(page.context(), token);

    await page.goto('/dashboard');
    await expect(page.getByTestId('trending-list')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid^="song-card-"]').first()).toBeVisible();
  });

  test('opening a song page loads the audio element + waveform', async ({ page, request }) => {
    const user = makeTestUser('happy_song');
    await signupViaApi(request, user);
    const token = await signinWithOtp(request, user);
    await attachSession(page.context(), token);

    await page.goto('/discover');
    const firstSong = page.locator('[data-testid^="song-card-"]').first();
    await expect(firstSong).toBeVisible({ timeout: 15_000 });
    await firstSong.click();
    await page.waitForURL(/\/song\/[a-z0-9-]+/);
    await expect(page.locator('audio')).toBeAttached();
    await expect(page.locator('[data-testid="play-button"]')).toBeVisible();
  });

  test('crossing the 25% threshold emits payment_due via realtime', async ({ page, request }) => {
    const user = makeTestUser('happy_threshold');
    await signupViaApi(request, user);
    const token = await signinWithOtp(request, user);
    await attachSession(page.context(), token);

    await page.goto('/discover');
    const firstSong = page.locator('[data-testid^="song-card-"]').first();
    await expect(firstSong).toBeVisible({ timeout: 15_000 });
    await firstSong.click();

    // Wait for the audio player + realtime status.
    await expect(page.locator('[data-testid="connection-status"]')).toBeVisible({ timeout: 10_000 });
    await waitForRealtimeConnected(page);

    // Force the audio position past 25% via the test bridge — the
    // audio playback API can't fast-forward in headless Chromium.
    const audioId = (await page.locator('[data-testid="song-id"]').textContent())?.trim();
    expect(audioId).toBeTruthy();
    await page.evaluate(async (songId: string) => {
      const res = await fetch('/api/realtime/test-skip', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ songId, percent: 30 }),
      });
      if (!res.ok) throw new Error(`test-skip failed: ${res.status}`);
    }, audioId!);

    // Listen for the payment_due event surfaced through the toast host.
    await expect(page.locator('[data-testid="payment-due-toast"]')).toBeVisible({ timeout: 15_000 });
  });

  test('payment_authorized → payment_settled round trip lands in history', async ({ page, request }) => {
    const user = makeTestUser('happy_payment');
    await signupViaApi(request, user);
    const token = await signinWithOtp(request, user);
    await attachSession(page.context(), token);

    await page.goto('/discover');
    await page.locator('[data-testid^="song-card-"]').first().click();
    await waitForRealtimeConnected(page);

    // Drive the full x402 round trip: payment_due → payment_authorized → settled.
    const songId = (await page.locator('[data-testid="song-id"]').textContent())?.trim()!;
    const streamId = await page.evaluate(async (sid: string) => {
      const start = await fetch('/api/realtime/test-stream-start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ songId: sid, atPercent: 30 }),
      });
      const { streamId } = await start.json();
      return streamId as string;
    }, songId);

    // Wait for the settled toast.
    await expect(page.locator('[data-testid="payment-settled-toast"]')).toBeVisible({ timeout: 20_000 });

    // Confirm a payment row was created server-side.
    const res = await request.get(`/api/payments/recent?streamId=${streamId}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { items: { status: string }[] };
    expect(body.items.at(0)?.status).toBe('settled');
  });

  test('admin dashboard renders overview + streaming health + agent health', async ({ page, request }) => {
    const admin = makeTestUser('admin_e2e', false);
    await signupViaApi(request, admin);
    const token = await signinWithOtp(request, admin);

    // Promote the user to admin via the test-only route.
    await request.post('/api/auth/test-promote', {
      data: { email: admin.email, role: 'admin' },
    });
    await attachSession(page.context(), token);

    await page.goto('/admin');
    await expect(page.getByTestId('overview-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('streaming-health-card')).toBeVisible();
    await expect(page.getByTestId('agent-health-card')).toBeVisible();
  });

  test('healthcheck endpoint returns ok', async ({ request }) => {
    const res = await request.get('/ready');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });
});
