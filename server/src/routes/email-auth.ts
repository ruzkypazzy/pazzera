/**
 * Email-only auth routes — Polaris Swarm's exact pattern.
 *
 * No passwords. No fallback. Circle sends the OTP. Period.
 *
 * Endpoints:
 *   POST /api/email-auth/start    { email }           — sends OTP, returns challengeId
 *   POST /api/email-auth/verify   { email, otp }      — verifies OTP + provisions wallet + signs session
 *   POST /api/email-auth/resend   { email }           — resends OTP (rate-limited)
 *
 * Requires Railway env vars:
 *   CIRCLE_API_KEY         - server-side API key
 *   CIRCLE_ENTITY_SECRET   - hex entity secret for DCW
 *   CIRCLE_WALLET_SET_ID   - the wallet set that holds user wallets
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import {
  ensureUser,
  sendEmailOtp,
  verifyEmailOtp,
  provisionUserWallet,
} from '../services/circle-dcw.js';
import { signSession, setSessionCookie } from '../services/auth.js';
import { audit } from '../services/audit.js';
import { authLimiters } from '../services/rate-limit.js';

export const emailAuthRouter = Router();

const startSchema = z.object({ email: z.string().email() });

emailAuthRouter.post('/start', authLimiters.signup, async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid email' });
  const { email } = parsed.data;

  // 1. Ensure Circle user exists
  const u = await ensureUser(email);
  if (!u.ok) {
    console.error('[email-auth/start] ensureUser failed:', u);
    return res.status(502).json({ error: 'Circle could not create user', detail: u.error });
  }

  // 2. Send OTP via Circle
  const otpRes = await sendEmailOtp(email);
  if (!otpRes.ok) {
    console.error('[email-auth/start] sendEmailOtp failed:', JSON.stringify(otpRes));
    audit(req, 'email_auth_start', { userId: null, email, metadata: { userExisted: true, otpSent: false, error: otpRes.error } });
    return res.status(502).json({
      error: 'Circle could not send the OTP email',
      detail: otpRes.error,
      status: otpRes.status,
      hint: 'Ensure CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and CIRCLE_WALLET_SET_ID are set on Railway. Check /api/debug/env to verify.',
    });
  }

  audit(req, 'email_auth_start', { userId: null, email, metadata: { userExisted: true, otpSent: true } });

  return res.json({
    ok: true,
    challengeId: email,
    sentBy: 'circle',
    message: 'OTP sent by Circle. Check your inbox.',
  });
});

const verifySchema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/),
  displayName: z.string().min(1).max(60).optional(),
  role: z.enum(['fan', 'artist']).optional(),
});

emailAuthRouter.post('/verify', async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', detail: parsed.error.flatten() });
  const { email, otp, displayName, role = 'fan' } = parsed.data;

  // Verify OTP with Circle
  const v = await verifyEmailOtp(email, otp);
  if (!v.ok) {
    audit(req, 'login_email_otp', { userId: null, email, metadata: { success: false, error: v.error } });
    return res.status(401).json({ error: 'Circle rejected the OTP', detail: v.error });
  }

  // Provision user row
  const db = getDb();
  let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
  if (!user) {
    const userId = randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO users (id, email, email_verified, display_name, role, password_hash, created_at, last_seen_at)
      VALUES (?, ?, 1, ?, ?, '', ?, ?)
    `).run(userId, email, displayName ?? email.split('@')[0], role, now, now);
    user = { id: userId, email, role, display_name: displayName ?? email.split('@')[0] };

    if (role === 'artist') {
      db.prepare(`
        INSERT INTO artists (id, user_id, display_name, verified, created_at)
        VALUES (?, ?, ?, 0, ?)
      `).run(randomUUID(), userId, user.display_name, now);
    }
    audit(req, 'signup_email_otp', { userId, email, role });
  } else {
    if (!user.email_verified) {
      db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(user.id);
    }
    audit(req, 'login_email_otp', { userId: user.id, email });
  }

  // Provision Circle DCW wallet (non-blocking — user gets logged in regardless)
  let walletResult: { ok: boolean; address?: string; walletId?: string; error?: string; steps: string[] } = { ok: false, steps: [], error: 'not attempted' };
  try {
    walletResult = await provisionUserWallet(email);
    if (!walletResult.ok) {
      console.error('[email-auth/verify] wallet provisioning failed:', walletResult.error, 'steps:', walletResult.steps);
    }
  } catch (e: any) {
    console.error('[email-auth/verify] wallet provisioning threw:', e);
    walletResult = { ok: false, error: e?.message ?? String(e), steps: [] };
  }

  // Persist wallet row
  if (walletResult.ok && walletResult.address) {
    const now = Date.now();
    const existing = db.prepare(`SELECT id FROM wallets WHERE user_id = ?`).get(user.id) as any;
    if (existing) {
      db.prepare(`
        UPDATE wallets SET address = ?, circle_user_id = ?, circle_wallet_id = ?,
                           pin_setup_complete = 1, updated_at = ?
        WHERE user_id = ?
      `).run(walletResult.address, email, walletResult.walletId ?? null, now, user.id);
    } else {
      db.prepare(`
        INSERT INTO wallets (id, user_id, circle_user_id, circle_wallet_id, address, blockchain, account_type,
                             pin_setup_complete, created_at)
        VALUES (?, ?, ?, ?, ?, 'ARC-TESTNET', 'EOA', 1, ?)
      `).run(randomUUID(), user.id, email, walletResult.walletId ?? null, walletResult.address, now);
    }
    audit(req, 'wallet_provisioned_dcw', { userId: user.id, address: walletResult.address });
  }

  // Issue session
  const jwt = signSession({ userId: user.id, email: user.email, role: user.role });
  setSessionCookie(res, jwt);

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      emailVerified: true,
      displayName: user.display_name,
      role: user.role,
    },
    wallet: walletResult.ok ? {
      address: walletResult.address,
      walletId: walletResult.walletId,
      circleManaged: true,
      pinSetupComplete: true,
    } : null,
    walletSteps: walletResult.steps,
    walletError: walletResult.ok ? null : walletResult.error,
  });
});

const resendSchema = z.object({ email: z.string().email() });

emailAuthRouter.post('/resend', authLimiters.signup, async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid email' });
  const { email } = parsed.data;

  const otpRes = await sendEmailOtp(email);
  if (!otpRes.ok) {
    return res.status(502).json({ error: 'Circle could not resend the OTP', detail: otpRes.error });
  }
  return res.json({ ok: true, sentBy: 'circle' });
});
