/**
 * POST /api/auth/request-otp
 *
 * Body: { email: string }
 * Returns: { ok: true, cooldownSec: number }
 *
 * Steps:
 *   1. Validate email shape + reject disposable domains
 *   2. Apply rate limits (per-email, per-IP)
 *   3. Compute AuthRiskScore; if > 60 → cooldown enforced before sending
 *   4. Generate 6-digit OTP, Argon2id hash, store in DB
 *   5. Send via Resend (or console-log in dev)
 *   6. Record AuthEvent('otp_requested')
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  withApi,
  ValidationError,
  RateLimitError,
  Limiters,
  requestOtp,
  sendOtpEmail,
  computeAuthRiskScore,
  isDisposableEmail,
  recordAuthEvent,
  extractIp,
  hashIp,
  getEnv,
  getParsedBody,
} from '@pazzera/core';

const Body = z.object({
  email: z.string().email().max(254),
  purpose: z.enum(['sign_in', 'reset_password', 'wallet_recovery', 'artist_upgrade']).optional(),
});

export const POST = withApi(
  async ({ req, requestId }) => {
    const { email, purpose } = getParsedBody<z.infer<typeof Body>>(req);

    // Disposable email block
    if (isDisposableEmail(email)) {
      await recordAuthEvent({
        type: 'disposable_email_blocked',
        email,
        severity: 30,
        meta: { purpose, requestId },
      });
      throw new ValidationError('Disposable email addresses are not allowed');
    }

    const ip = extractIp(req);
    const ipHash = hashIp(ip);
    const userAgent = req.headers.get('user-agent');

    // Rate limits (per email and per IP, both enforced)
    try {
      await Limiters.otpPerIp().consume(ip ?? 'unknown', 1);
    } catch (err) {
      throw new RateLimitError(
        err instanceof Error ? 60 : 60,
      );
    }
    try {
      await Limiters.otpPerEmail().consume(email, 1);
    } catch (err) {
      throw new RateLimitError(60);
    }

    // Risk-score cooldown
    const risk = await computeAuthRiskScore(email, ipHash);
    if (risk.cooldownSeconds > 0) {
      await recordAuthEvent({
        type: 'cooldown_applied',
        email,
        ipHash,
        severity: risk.total,
        meta: { cooldownSeconds: risk.cooldownSeconds, requestId },
      });
      throw new RateLimitError(risk.cooldownSeconds);
    }

    const { code, expiresAt } = await requestOtp({
      email,
      purpose: purpose ?? 'sign_in',
      ipHash,
      userAgent,
    });

    const sent = await sendOtpEmail({ to: email, code, expiresAt, ipHash, userAgent });

    return new Response(
      JSON.stringify({
        ok: true,
        delivered: sent.delivered,
        cooldownSec: getEnv().OTP_TTL_SECONDS,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { bodySchema: Body },
);