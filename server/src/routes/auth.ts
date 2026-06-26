/**
 * Auth routes — email + password signup/login with real Circle W3S wallet
 * provisioning on the side.
 *
 * Flow:
 *   POST /api/auth/signup  { email, password, displayName, role }
 *     - validates input, hashes password
 *     - creates user row
 *     - calls circle.createUser({ userId: email })
 *     - calls circle.createUserToken({ userId }) → userToken + encryptionKey
 *     - calls circle.createUserPinWithWallets(...) → challengeId
 *     - stores wallet row (pin_setup_complete = 0)
 *     - if role='artist', creates artist row
 *     - returns { user, challengeId, userToken, encryptionKey }
 *     - frontend runs sdk.execute(challengeId) → user sets PIN → wallet active
 *
 *   POST /api/auth/login  { email, password }
 *     - validates credentials
 *     - returns { user, wallet } (challengeId only if PIN not yet set)
 *
 *   POST /api/auth/logout — clears cookie
 *   GET  /api/auth/me      — returns current user + wallet
 *   POST /api/auth/complete-pin-setup  — frontend calls after sdk.execute
 *     marks the wallet row as pin_setup_complete=1
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
import { createUser, createUserToken, createUserPinWithWallets, listWallets } from '../services/circle.js';

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(60),
  role: z.enum(['fan', 'artist']).default('fan'),
  bio: z.string().max(500).optional(),
});

// ─── Signup ────────────────────────────────────────────────
authRouter.post('/signup', async (req, res) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid signup', details: parsed.error.flatten() });
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
      console.error('[auth/signup] circle error (continuing without wallet):', e?.response?.data ?? e?.message ?? e);
      // Don't block signup if Circle hiccups — user can retry wallet setup later.
    }

    // If circle already returned an existing wallet (challenge error 155106),
    // fall back to listWallets to grab the address.
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
        INSERT INTO wallets (id, user_id, circle_user_id, circle_wallet_id, address, blockchain, account_type, pin_setup_complete, created_at)
        VALUES (?, ?, ?, ?, ?, 'ARC-TESTNET', 'SCA', ?, ?)
      `).run(randomUUID(), userId, email, walletId, walletAddress, challengeId ? 0 : 1, now);
    }

    // Issue session JWT
    const jwt = signSession({ userId, email, role });
    setSessionCookie(res, jwt);

    const user = db.prepare('SELECT id, email, display_name, role, created_at FROM users WHERE id = ?').get(userId);
    res.json({
      user,
      wallet: walletAddress ? { address: walletAddress, pinSetupComplete: !challengeId } : null,
      challengeId,            // frontend runs sdk.execute(challengeId) if non-null
      userToken,              // frontend passes to sdk.setAuthentication(...)
      encryptionKey,          // ditto
    });
  } catch (e: any) {
    console.error('[auth/signup]', e);
    res.status(500).json({ error: 'signup failed', detail: e?.message ?? String(e) });
  }
});

// ─── Login ─────────────────────────────────────────────────
authRouter.post('/login', async (req, res) => {
  try {
    const parsed = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid login' });
    const { email, password } = parsed.data;

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);

    const wallet = db.prepare('SELECT address, pin_setup_complete as pinSetupComplete FROM wallets WHERE user_id = ?').get(user.id);

    const jwt = signSession({ userId: user.id, email: user.email, role: user.role });
    setSessionCookie(res, jwt);

    res.json({
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
      wallet: wallet ?? null,
    });
  } catch (e: any) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'login failed', detail: e?.message ?? String(e) });
  }
});

// ─── Logout ────────────────────────────────────────────────
authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ─── Me (current user) ────────────────────────────────────
authRouter.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const session = (req as any).session;
  const user = db.prepare('SELECT id, email, display_name, role, created_at, last_login_at FROM users WHERE id = ?').get(session.userId);
  const wallet = db.prepare('SELECT address, pin_setup_complete as pinSetupComplete FROM wallets WHERE user_id = ?').get(session.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ user, wallet: wallet ?? null });
});

// ─── Complete PIN setup ───────────────────────────────────
authRouter.post('/complete-pin-setup', requireAuth, (req, res) => {
  const db = getDb();
  const session = (req as any).session;
  db.prepare('UPDATE wallets SET pin_setup_complete = 1 WHERE user_id = ?').run(session.userId);
  res.json({ ok: true });
});

// ─── Refresh session user token (for Circle SDK after 60min expiry) ───
authRouter.post('/refresh-circle-token', requireAuth, async (req, res) => {
  const db = getDb();
  const session = (req as any).session;
  try {
    const t = await createUserToken(session.email);
    res.json({ userToken: t.userToken, encryptionKey: t.encryptionKey });
  } catch (e: any) {
    console.error('[auth/refresh-circle-token]', e);
    res.status(502).json({ error: 'failed to refresh circle token', detail: e?.message ?? String(e) });
  }
});