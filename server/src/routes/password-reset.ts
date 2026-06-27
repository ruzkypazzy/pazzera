/**
 * Password reset flow:
 *   POST /api/auth/forgot-password { email } — sends reset email
 *   POST /api/auth/reset-password  { token, newPassword } — sets new password
 *
 * Tokens are single-use, 1-hour expiry, stored as SHA-256 hashes (not plain).
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { hashPassword } from '../services/auth.js';
import { sendEmail, emailTemplates, generateToken } from '../services/email.js';
import { hashToken } from '../services/crypto.js';
import { audit } from '../services/audit.js';

export const passwordResetRouter = Router();

const TOKEN_TTL_MS = 60 * 60 * 1000;  // 1 hour

passwordResetRouter.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email required' });

    const db = getDb();
    const user = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(email) as any;

    // Always return 200 (don't leak which emails exist)
    if (!user) {
      return res.json({ ok: true });
    }

    const token = generateToken(32);
    const tokenHash = hashToken(token);
    const expires = Date.now() + TOKEN_TTL_MS;

    db.prepare(`
      INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), user.id, tokenHash, expires, Date.now());

    const resetUrl = `${process.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/reset-password?token=${token}&uid=${user.id}`;
    const tpl = emailTemplates().passwordReset(resetUrl, user.display_name);
    const result = await sendEmail({ to: email, ...tpl });

    audit(req, 'password_reset_requested', { userId: user.id });
    res.json({
      ok: true,
      sent: result.ok,
      previewUrl: result.previewUrl,
      error: result.error,
    });
  } catch (e: any) {
    console.error('[auth/forgot-password]', e);
    res.status(500).json({ error: 'failed', detail: e?.message ?? String(e) });
  }
});

const resetSchema = z.object({
  token: z.string().min(32).max(128),
  uid: z.string().uuid(),
  newPassword: z.string().min(8).max(200),
});

passwordResetRouter.post('/reset-password', async (req, res) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid input' });
    const { token, uid, newPassword } = parsed.data;
    const db = getDb();

    const row = db.prepare(`
      SELECT id, expires_at, used_at FROM password_resets
      WHERE user_id = ? AND token_hash = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(uid, hashToken(token)) as any;

    if (!row) return res.status(400).json({ error: 'invalid or expired token' });
    if (row.used_at) return res.status(400).json({ error: 'token already used' });
    if (Date.now() > row.expires_at) return res.status(400).json({ error: 'token expired' });

    const newHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?').run(newHash, uid);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
    // Invalidate all sessions for this user
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), uid);

    audit(req, 'password_reset_completed', { userId: uid });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[auth/reset-password]', e);
    res.status(500).json({ error: 'failed', detail: e?.message ?? String(e) });
  }
});