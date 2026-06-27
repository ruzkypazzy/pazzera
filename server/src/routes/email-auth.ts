/**
 * Email-only auth routes — Polaris Swarm-style.
 *
 * No passwords. User enters email → we call Circle to send a 6-digit OTP
 * (FROM CIRCLE, not from us) → user enters OTP → we call Circle to
 * verify → we provision a DCW wallet server-side → we issue our own
 * session cookie.
 *
 * Endpoints:
 *   POST /api/email-auth/start    { email }           — sends OTP, returns challengeId
 *   POST /api/email-auth/verify   { email, otp }      — verifies OTP + provisions wallet + signs session
 *   POST /api/email-auth/resend   { email }           — resends OTP (rate-limited)
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
import { encryptString } from '../services/crypto.js';
import { sendEmail, emailTemplates } from '../services/email.js';

export const emailAuthRouter = Router();

// In-memory OTP store: { [email]: { code, expiresAt, attempts } }
// Production should use Redis or DB. For hackathon, in-memory is fine.
const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();

function genOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const startSchema = z.object({
  email: z.string().email(),
});

emailAuthRouter.post('/start', authLimiters.signup, async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid email' });
  const { email } = parsed.data;

  // 1. Ensure Circle user exists (idempotent)
  const u = await ensureUser(email);
  audit(req, 'email_auth_start', { userId: null, email, metadata: { userExisted: u.exists } });

  // 2. Send OTP via Circle
  const otpRes = await sendEmailOtp(email);
  if (!otpRes.ok) {
    console.error('[email-auth/start] Circle OTP send failed:', otpRes);
    // Fallback: send our own OTP so the demo works even if Circle is down
    const code = genOtp();
    otpStore.set(email, { code, expiresAt: Date.now() + 10 * 60_000, attempts: 0 });
    const tpl = emailTemplates().verifyEmail('', code);
    const mail = await sendEmail({ to: email, ...tpl }).catch((e) => ({ ok: false, error: e.message }));
    console.log('[email-auth/start] fallback OTP for', email, '->', code, 'preview:', (mail as any)?.previewUrl);
    return res.json({
      ok: true,
      challengeId: email,
      sentBy: 'pazzera-fallback',
      previewUrl: (mail as any)?.previewUrl,
      message: 'OTP sent. Check your inbox.',
    });
  }

  // Store a placeholder so verify can find the channel (Circle's OTP isn't stored by us)
  otpStore.set(email, { code: 'CIRCLE-MANAGED', expiresAt: Date.now() + 10 * 60_000, attempts: 0 });

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

  const stored = otpStore.get(email);
  if (!stored) {
    return res.status(400).json({ error: 'no OTP requested for this email. Tap "Send code" first.' });
  }
  if (stored.expiresAt < Date.now()) {
    otpStore.delete(email);
    return res.status(400).json({ error: 'OTP expired. Tap "Resend code".' });
  }
  if (stored.attempts >= 5) {
    otpStore.delete(email);
    return res.status(429).json({ error: 'too many attempts. Tap "Resend code".' });
  }

  // Two paths: Circle-managed OTP (preferred) OR our fallback OTP
  if (stored.code === 'CIRCLE-MANAGED') {
    // Verify with Circle
    const v = await verifyEmailOtp(email, otp);
    if (!v.ok) {
      stored.attempts += 1;
      return res.status(401).json({ error: 'Circle rejected the OTP', detail: v.error });
    }
  } else {
    // Verify against our stored code
    if (stored.code !== otp) {
      stored.attempts += 1;
      return res.status(401).json({ error: 'wrong code' });
    }
  }

  otpStore.delete(email);

  // Now: provision or fetch user + wallet
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
    // Mark email verified if it wasn't
    if (!user.email_verified) {
      db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(user.id);
    }
    audit(req, 'login_email_otp', { userId: user.id, email });
  }

  // Provision Circle DCW wallet
  let walletResult;
  try {
    walletResult = await provisionUserWallet(email);
  } catch (e: any) {
    console.error('[email-auth/verify] wallet provisioning failed:', e);
    walletResult = { ok: false, error: e?.message ?? String(e), steps: [] };
  }

  // Persist wallet row
  const now = Date.now();
  if (walletResult.ok && walletResult.address) {
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

  // Return user info
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

  const stored = otpStore.get(email);
  if (stored && stored.expiresAt > Date.now() && Date.now() - (stored.expiresAt - 10 * 60_000) < 30_000) {
    return res.status(429).json({ error: 'wait 30 seconds before requesting another code' });
  }

  // Same logic as /start
  const otpRes = await sendEmailOtp(email);
  if (!otpRes.ok) {
    const code = genOtp();
    otpStore.set(email, { code, expiresAt: Date.now() + 10 * 60_000, attempts: 0 });
    const tpl = emailTemplates().verifyEmail('', code);
    const mail = await sendEmail({ to: email, ...tpl }).catch(() => null);
    return res.json({
      ok: true,
      sentBy: 'pazzera-fallback',
      previewUrl: (mail as any)?.previewUrl,
    });
  }
  otpStore.set(email, { code: 'CIRCLE-MANAGED', expiresAt: Date.now() + 10 * 60_000, attempts: 0 });
  return res.json({ ok: true, sentBy: 'circle' });
});