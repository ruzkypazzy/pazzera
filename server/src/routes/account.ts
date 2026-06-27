/**
 * Account routes — profile management, wallet balance, email verification,
 * password change, account deletion.
 *
 * Auth required for everything except public profile lookup.
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { requireAuth } from '../services/auth.js';
import { hashPassword, verifyPassword } from '../services/auth.js';
import { encryptString, decryptString, hashToken } from '../services/crypto.js';
import { sendEmail, emailTemplates, generateToken } from '../services/email.js';
import { getUsdcBalance, getNativeBalance, ARC_CONSTANTS } from '../services/arc.js';
import { audit } from '../services/audit.js';

export const accountRouter = Router();

// ─── GET /api/account — full profile + wallet + balance ───
accountRouter.get('/', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const session = (req as any).session;

    const user = db.prepare(`
      SELECT id, email, email_verified, display_name, bio, avatar_url, location, social_links,
             role, two_factor_enabled, created_at, last_login_at, last_seen_at
      FROM users WHERE id = ?
    `).get(session.userId) as any;
    if (!user) return res.status(404).json({ error: 'user not found' });

    let socialLinks: Record<string, string> = {};
    try {
      socialLinks = user.social_links ? JSON.parse(user.social_links) : {};
    } catch {}

    const wallet = db.prepare(`
      SELECT id, address, blockchain, account_type, pin_setup_complete, cached_balance_usdc, last_balance_check_at
      FROM wallets WHERE user_id = ?
    `).get(session.userId) as any;

    // Fetch fresh USDC balance (or use cached if checked <30s ago)
    let usdcBalance = wallet?.cached_balance_usdc || '0';
    let nativeBalance = '0';
    const now = Date.now();
    const cacheAge = wallet?.last_balance_check_at ? now - wallet.last_balance_check_at : Infinity;
    if (wallet?.address && cacheAge > 30_000) {
      try {
        const [u, n] = await Promise.all([
          getUsdcBalance(wallet.address),
          getNativeBalance(wallet.address),
        ]);
        usdcBalance = u;
        nativeBalance = n;
        db.prepare(`UPDATE wallets SET cached_balance_usdc = ?, last_balance_check_at = ? WHERE user_id = ?`)
          .run(usdcBalance, now, session.userId);
      } catch (e) {
        // keep cached value on RPC failure
      }
    }

    let artist = null;
    if (user.role === 'artist') {
      artist = db.prepare(`SELECT id, bio, avatar_url, cover_image_url, social_links, verified, created_at FROM artists WHERE user_id = ?`).get(session.userId);
    }

    res.json({
      user: {
        ...user,
        emailVerified: !!user.email_verified,
        socialLinks,
        twoFactorEnabled: !!user.two_factor_enabled,
      },
      wallet: wallet ? {
        ...wallet,
        pinSetupComplete: !!wallet.pin_setup_complete,
        usdcBalance,
        nativeBalance,
        arc: ARC_CONSTANTS,
        faucetUrl: `${ARC_CONSTANTS.FAUCET_URL}?address=${wallet.address}`,
      } : null,
      artist,
    });
  } catch (e: any) {
    console.error('[account/get]', e);
    res.status(500).json({ error: 'failed to load account', detail: e?.message ?? String(e) });
  }
});

// ─── PATCH /api/account — update profile fields ──────────
const profileSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  location: z.string().max(100).optional(),
  socialLinks: z.object({
    twitter: z.string().max(100).optional(),
    instagram: z.string().max(100).optional(),
    website: z.string().url().max(200).optional(),
    farcaster: z.string().max(100).optional(),
  }).optional(),
});

accountRouter.patch('/', requireAuth, async (req, res) => {
  try {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid profile', details: parsed.error.flatten() });
    const { displayName, bio, avatarUrl, location, socialLinks } = parsed.data;
    const db = getDb();
    const session = (req as any).session;

    // Build dynamic UPDATE
    const updates: string[] = [];
    const values: any[] = [];
    if (displayName !== undefined) { updates.push('display_name = ?'); values.push(displayName); }
    if (bio !== undefined) { updates.push('bio = ?'); values.push(bio); }
    if (avatarUrl !== undefined) { updates.push('avatar_url = ?'); values.push(avatarUrl); }
    if (location !== undefined) { updates.push('location = ?'); values.push(location); }
    if (socialLinks !== undefined) { updates.push('social_links = ?'); values.push(JSON.stringify(socialLinks)); }
    if (updates.length === 0) return res.status(400).json({ error: 'no fields to update' });

    values.push(session.userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Sync bio/avatar to artists table if artist
    if (session.role === 'artist') {
      const aUpdates: string[] = [];
      const aValues: any[] = [];
      if (bio !== undefined) { aUpdates.push('bio = ?'); aValues.push(bio); }
      if (avatarUrl !== undefined) { aUpdates.push('avatar_url = ?'); aValues.push(avatarUrl); }
      if (socialLinks !== undefined) { aUpdates.push('social_links = ?'); aValues.push(JSON.stringify(socialLinks)); }
      if (aUpdates.length > 0) {
        aValues.push(session.userId);
        db.prepare(`UPDATE artists SET ${aUpdates.join(', ')} WHERE user_id = ?`).run(...aValues);
      }
    }

    audit(req, 'profile_updated', { userId: session.userId, fields: Object.keys(parsed.data) });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[account/patch]', e);
    res.status(500).json({ error: 'failed to update profile', detail: e?.message ?? String(e) });
  }
});

// ─── POST /api/account/avatar — upload avatar (returns URL) ───
// Accepts multipart upload; stores on local volume; returns CDN URL.
// For hackathon: local volume + reverse proxy. For production: S3.
accountRouter.post('/avatar', requireAuth, async (req, res) => {
  try {
    // Body is JSON { dataUrl: "data:image/png;base64,..." } for simplicity
    const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'dataUrl required (data:image/...)' });
    }
    const session = (req as any).session;
    const db = getDb();

    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'invalid data URL format' });
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    // 5MB cap
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'avatar too large (max 5MB)' });
    }

    const uploadId = randomUUID();
    const uploadDir = process.env.UPLOADS_DIR ?? './uploads';
    const filepath = `${uploadDir}/avatars/${session.userId}/${uploadId}.${ext}`;
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(`${uploadDir}/avatars/${session.userId}`, { recursive: true });
    writeFileSync(filepath, buffer);

    const url = `/uploads/avatars/${session.userId}/${uploadId}.${ext}`;
    db.prepare(`UPDATE users SET avatar_url = ? WHERE id = ?`).run(url, session.userId);
    if (session.role === 'artist') {
      db.prepare(`UPDATE artists SET avatar_url = ? WHERE user_id = ?`).run(url, session.userId);
    }
    db.prepare(`
      INSERT INTO uploads (id, user_id, filename, mime_type, size_bytes, kind, storage_path, sha256, created_at)
      VALUES (?, ?, ?, ?, ?, 'avatar', ?, ?, ?)
    `).run(uploadId, session.userId, filename ?? `avatar.${ext}`, `image/${match[1]}`, buffer.length, filepath, '', Date.now());

    res.json({ ok: true, url });
  } catch (e: any) {
    console.error('[account/avatar]', e);
    res.status(500).json({ error: 'avatar upload failed', detail: e?.message ?? String(e) });
  }
});

// ─── POST /api/account/change-password ───────────────────
const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

accountRouter.post('/change-password', requireAuth, async (req, res) => {
  try {
    const parsed = changePwSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid input' });
    const { currentPassword, newPassword } = parsed.data;
    const session = (req as any).session;
    const db = getDb();
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.userId) as any;
    if (!user) return res.status(404).json({ error: 'user not found' });

    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'current password incorrect' });

    const newHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, session.userId);
    audit(req, 'password_reset_completed', { userId: session.userId, method: 'self-serve' });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[account/change-password]', e);
    res.status(500).json({ error: 'failed', detail: e?.message ?? String(e) });
  }
});

// ─── POST /api/account/verify-email/send ──────────────────
accountRouter.post('/verify-email/send', requireAuth, async (req, res) => {
  try {
    const session = (req as any).session;
    const db = getDb();
    const user = db.prepare('SELECT email, display_name, email_verified FROM users WHERE id = ?').get(session.userId) as any;
    if (!user) return res.status(404).json({ error: 'user not found' });
    if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });

    const token = generateToken(32);
    const tokenHash = hashToken(token);
    const expires = Date.now() + 24 * 60 * 60 * 1000;  // 24h
    db.prepare(`UPDATE users SET email_verification_token = ?, email_verification_expires_at = ? WHERE id = ?`)
      .run(tokenHash, expires, session.userId);

    const verifyUrl = `${process.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/verify-email?token=${token}&uid=${session.userId}`;
    const tpl = emailTemplates().verification(verifyUrl, user.display_name);
    const result = await sendEmail({ to: user.email, ...tpl });

    audit(req, 'email_verification_sent', { userId: session.userId });
    res.json({
      ok: true,
      sent: result.ok,
      previewUrl: result.previewUrl,
      error: result.error,
    });
  } catch (e: any) {
    console.error('[account/verify-email/send]', e);
    res.status(500).json({ error: 'failed', detail: e?.message ?? String(e) });
  }
});

// ─── GET /api/account/verify-email?token=...&uid=...  (no auth) ──
accountRouter.get('/verify-email', (req, res) => {
  try {
    const { token, uid } = req.query as { token?: string; uid?: string };
    if (!token || !uid) return res.status(400).send('Missing token or uid');

    const db = getDb();
    const user = db.prepare('SELECT email_verification_token, email_verification_expires_at, email_verified, display_name FROM users WHERE id = ?').get(uid) as any;
    if (!user) return res.status(404).send('User not found');
    if (user.email_verified) return res.redirect(`${process.env.PUBLIC_BASE_URL || ''}/account?verified=already`);
    if (!user.email_verification_token || user.email_verification_token !== hashToken(token)) {
      return res.status(400).send('Invalid verification link');
    }
    if (Date.now() > (user.email_verification_expires_at ?? 0)) {
      return res.status(400).send('Verification link expired — request a new one');
    }

    db.prepare(`UPDATE users SET email_verified = 1, email_verification_token = NULL, email_verification_expires_at = NULL WHERE id = ?`).run(uid);
    audit(req, 'email_verification_completed', { userId: uid });

    res.redirect(`${process.env.PUBLIC_BASE_URL || ''}/account?verified=1`);
  } catch (e: any) {
    console.error('[account/verify-email]', e);
    res.status(500).send('Verification failed');
  }
});

// ─── POST /api/account/wallet/refresh-balance ────────────
accountRouter.post('/wallet/refresh-balance', requireAuth, async (req, res) => {
  try {
    const session = (req as any).session;
    const db = getDb();
    const wallet = db.prepare('SELECT address FROM wallets WHERE user_id = ?').get(session.userId) as any;
    if (!wallet) return res.status(404).json({ error: 'no wallet' });

    const [usdc, native] = await Promise.all([
      getUsdcBalance(wallet.address),
      getNativeBalance(wallet.address),
    ]);
    db.prepare(`UPDATE wallets SET cached_balance_usdc = ?, last_balance_check_at = ? WHERE user_id = ?`)
      .run(usdc, Date.now(), session.userId);

    res.json({ ok: true, usdcBalance: usdc, nativeBalance: native });
  } catch (e: any) {
    console.error('[account/refresh-balance]', e);
    res.status(500).json({ error: 'failed', detail: e?.message ?? String(e) });
  }
});

// ─── POST /api/account/wallet/complete-pin ───────────────
accountRouter.post('/wallet/complete-pin', requireAuth, (req, res) => {
  const db = getDb();
  const session = (req as any).session;
  db.prepare(`UPDATE wallets SET pin_setup_complete = 1 WHERE user_id = ?`).run(session.userId);
  audit(req, 'wallet_pin_completed', { userId: session.userId });
  res.json({ ok: true });
});

// ─── DELETE /api/account — delete account (irreversible) ─
accountRouter.delete('/', requireAuth, async (req, res) => {
  try {
    const { confirmPassword } = req.body as { confirmPassword?: string };
    if (!confirmPassword) return res.status(400).json({ error: 'confirmPassword required' });
    const session = (req as any).session;
    const db = getDb();
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.userId) as any;
    if (!user) return res.status(404).json({ error: 'user not found' });

    const ok = await verifyPassword(confirmPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'password incorrect' });

    // Cascades will clean wallets, plays, tracks, sessions, etc.
    db.prepare(`DELETE FROM users WHERE id = ?`).run(session.userId);
    audit(req, 'account_deleted', { userId: session.userId });
    res.clearCookie('pazzera_session');
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[account/delete]', e);
    res.status(500).json({ error: 'delete failed', detail: e?.message ?? String(e) });
  }
});