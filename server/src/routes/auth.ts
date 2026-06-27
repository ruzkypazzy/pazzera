/**
 * Auth routes — email + password signup/login with real Circle W3S wallet
 * provisioning on the side.
 *
 * Flow:
 *   POST /api/auth/signup  { email, password, displayName, role }
 *     - validates input, hashes password, rate-limited per IP
 *     - creates user row (wallet row created after Circle provisioning)
 *     - calls circle.createUser({ userId: email })
 *     - calls circle.createUserToken({ userId }) → userToken + encryptionKey
 *     - calls circle.createUserPinWithWallets(...) → challengeId
 *     - encrypts userToken + encryptionKey at rest with AES-256-GCM
 *     - if role='artist', creates artist row
 *     - issues JWT session cookie
 *     - sends welcome email with wallet address + faucet link
 *     - returns { user, wallet, challengeId, userToken, encryptionKey }
 *
 *   POST /api/auth/login  { email, password }
 *     - validates credentials, checks account lockout (5 fails = 15min)
 *     - on success: reset fail counter, update last_login_at
 *     - returns { user, wallet }
 *
 *   POST /api/auth/logout — clears cookie
 *   GET  /api/auth/me      — returns current user + wallet
 *   POST /api/auth/complete-pin-setup — frontend calls after sdk.execute
 *     marks the wallet row as pin_setup_complete=1
 *   POST /api/auth/refresh-circle-token — refresh 60min userToken for SDK
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} from '../services/auth.js';
import { encryptString, decryptString } from '../services/crypto.js';
import { sendEmail, emailTemplates } from '../services/email.js';
import { authLimiters } from '../services/rate-limit.js';
import { audit } from '../services/audit.js';
import { createUser, createUserToken, createUserPinWithWallets, listWallets } from '../services/circle.js';

export const authRouter = Router();

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_DURATION_MS = 15 * 60_000;  // 15 minutes

const signupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(60),
  role: z.enum(['fan', 'artist']).default('fan'),
  bio: z.string().max(500).optional(),
});

// ─── Signup ────────────────────────────────────────────────
authRouter.post('/signup', authLimiters.signup, async (req, res) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid signup', details: parsed.error.flatten() });
    }
    const { email, password, displayName, role, bio } = parsed.data;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any;
    if (existing) return res.status(409).json({ error: 'email already registered' });

    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, email, passwordHash, displayName, role, now);

    if (role === 'artist') {
      db.prepare(`INSERT INTO artists (id, user_id, bio, created_at) VALUES (?, ?, ?, ?)`)
        .run(randomUUID(), userId, bio ?? null, now);
    }

    // Provision Circle wallet — createUser + userToken + pin challenge.
    let challengeId: string | null = null;
    let userToken: string | null = null;
    let encryptionKey: string | null = null;
    let walletId: string | null = null;
    let walletAddress: string | null = null;

    try {
      await createUser(email);
      const t = await createUserToken(email);
      userToken = t.userToken;
      encryptionKey = t.encryptionKey;
      const pin = await createUserPinWithWallets(userToken, ['ARC-TESTNET'], 'SCA');
      challengeId = pin.challengeId;
    } catch (e: any) {
      console.error('[auth/signup] circle error:', e?.response?.data ?? e?.message ?? e);
      // Don't block signup if Circle hiccups — user can retry wallet setup later.
    }

    if (!walletAddress && userToken) {
      try {
        const list = await listWallets(userToken);
        const w = list.wallets?.[0];
        if (w) {
          walletId = w.id;
          walletAddress = w.address;
        }
      } catch {}
    }

    if (walletId && walletAddress) {
      db.prepare(`
        INSERT INTO wallets (id, user_id, circle_user_id, circle_wallet_id, address, blockchain, account_type,
                              pin_setup_complete, circle_user_token_enc, circle_encryption_key_enc, created_at)
        VALUES (?, ?, ?, ?, ?, 'ARC-TESTNET', 'SCA', ?, ?, ?, ?)
      `).run(
        randomUUID(),
        userId,
        email,
        walletId,
        walletAddress,
        challengeId ? 0 : 1,
        userToken ? encryptString(userToken) : null,
        encryptionKey ? encryptString(encryptionKey) : null,
        now,
      );
      audit(req, 'wallet_provisioned', { userId, address: walletAddress });
    }

    // Issue session JWT
    const jwt = signSession({ userId, email, role });
    setSessionCookie(res, jwt);

    audit(req, 'signup', { userId, role });

    // Send welcome email with wallet + faucet link (async, don't block)
    if (walletAddress) {
      const tpl = emailTemplates().welcomeWithWallet(
        displayName,
        walletAddress,
        `https://faucet.circle.com?address=${walletAddress}`,
      );
      sendEmail({ to: email, ...tpl }).catch(e => console.error('[email] welcome send failed:', e));
    }

    const user = db.prepare(`
      SELECT id, email, email_verified, display_name, role, created_at
      FROM users WHERE id = ?
    `).get(userId);
    res.json({
      user,
      wallet: walletAddress ? { address: walletAddress, pinSetupComplete: !challengeId } : null,
      challengeId,
      userToken,
      encryptionKey,
    });
  } catch (e: any) {
    console.error('[auth/signup]', e);
    res.status(500).json({ error: 'signup failed', detail: e?.message ?? String(e) });
  }
});

// ─── Login ─────────────────────────────────────────────────
authRouter.post('/login', authLimiters.login, async (req, res) => {
  try {
    const parsed = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid login' });
    const { email, password } = parsed.data;

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user) {
      audit(req, 'login_failed', { email, reason: 'no-user' });
      return res.status(401).json({ error: 'invalid credentials' });
    }

    // Account lockout check
    if (user.locked_until && user.locked_until > Date.now()) {
      const minsLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
      return res.status(423).json({
        error: 'account temporarily locked',
        lockedUntil: user.locked_until,
        minutesLeft: minsLeft,
      });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const newFailCount = (user.failed_login_count ?? 0) + 1;
      const lockUntil = newFailCount >= MAX_FAILED_LOGINS ? Date.now() + LOCKOUT_DURATION_MS : null;
      db.prepare(`UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?`)
        .run(newFailCount, lockUntil, user.id);
      audit(req, 'login_failed', { email, reason: 'bad-password', failCount: newFailCount });
      if (lockUntil) {
        return res.status(423).json({
          error: 'too many failed attempts',
          lockedUntil: lockUntil,
          minutesLeft: Math.ceil(LOCKOUT_DURATION_MS / 60000),
        });
      }
      return res.status(401).json({ error: 'invalid credentials' });
    }

    db.prepare(`UPDATE users SET last_login_at = ?, last_seen_at = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?`)
      .run(Date.now(), Date.now(), user.id);

    const wallet = db.prepare(`
      SELECT address, pin_setup_complete as pinSetupComplete, cached_balance_usdc as usdcBalance
      FROM wallets WHERE user_id = ?
    `).get(user.id);

    const jwt = signSession({ userId: user.id, email: user.email, role: user.role });
    setSessionCookie(res, jwt);

    audit(req, 'login', { userId: user.id });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        email_verified: !!user.email_verified,
      },
      wallet: wallet ?? null,
    });
  } catch (e: any) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'login failed', detail: e?.message ?? String(e) });
  }
});

// ─── Logout ────────────────────────────────────────────────
authRouter.post('/logout', (req, res) => {
  audit(req, 'logout');
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ─── Me (current user) ────────────────────────────────────
authRouter.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const session = (req as any).session;
  db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).run(Date.now(), session.userId);
  const user = db.prepare(`
    SELECT id, email, email_verified, display_name, bio, avatar_url, role, two_factor_enabled,
           created_at, last_login_at
    FROM users WHERE id = ?
  `).get(session.userId);
  const wallet = db.prepare(`
    SELECT address, pin_setup_complete as pinSetupComplete, cached_balance_usdc as usdcBalance
    FROM wallets WHERE user_id = ?
  `).get(session.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ user, wallet: wallet ?? null });
});

// ─── Complete PIN setup ───────────────────────────────────
authRouter.post('/complete-pin-setup', requireAuth, (req, res) => {
  const db = getDb();
  const session = (req as any).session;
  db.prepare(`UPDATE wallets SET pin_setup_complete = 1 WHERE user_id = ?`).run(session.userId);
  audit(req, 'wallet_pin_completed', { userId: session.userId });
  res.json({ ok: true });
});

// ─── Refresh session user token (for Circle SDK after 60min expiry) ───
authRouter.post('/refresh-circle-token', requireAuth, async (req, res) => {
  const db = getDb();
  const session = (req as any).session;
  try {
    const t = await createUserToken(session.email);
    // Update stored encrypted copy
    db.prepare(`UPDATE wallets SET circle_user_token_enc = ?, circle_encryption_key_enc = ? WHERE user_id = ?`)
      .run(encryptString(t.userToken), encryptString(t.encryptionKey), session.userId);
    res.json({ userToken: t.userToken, encryptionKey: t.encryptionKey });
  } catch (e: any) {
    console.error('[auth/refresh-circle-token]', e);
    res.status(502).json({ error: 'failed to refresh circle token', detail: e?.message ?? String(e) });
  }
});