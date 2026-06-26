import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db.js';
import { getOrCreateWallet, requestFaucetFunding } from '../services/circle.js';

export const artistsRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(60),
  bio: z.string().max(500).optional(),
});

artistsRouter.post('/signup', async (req, res) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid signup', details: parsed.error.flatten() });
    }
    const { email, displayName, bio } = parsed.data;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM artists WHERE email = ?').get(email) as any;
    if (existing) return res.json({ artist: existing });

    let wallet;
    try {
      wallet = await getOrCreateWallet(email);
    } catch (e: any) {
      console.error('[artists/signup] circle error:', e?.response?.data ?? e?.message ?? e);
      return res.status(502).json({
        error: 'circle wallet creation failed',
        detail: e?.response?.data?.message ?? e?.message ?? String(e),
      });
    }

    requestFaucetFunding(wallet.address).catch(() => {});

    const id = randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO artists (id, email, display_name, bio, wallet_id, wallet_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, displayName, bio ?? null, wallet.walletId, wallet.address, now);

    const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id);
    res.json({ artist });
  } catch (e: any) {
    console.error('[artists/signup] unhandled:', e);
    res.status(500).json({ error: 'signup failed', detail: e?.message ?? String(e) });
  }
});

artistsRouter.get('/:id', (req, res) => {
  const db = getDb();
  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(req.params.id) as any;
  if (!artist) return res.status(404).json({ error: 'artist not found' });
  const tracks = db.prepare('SELECT * FROM tracks WHERE artist_id = ? AND published = 1 ORDER BY created_at DESC').all(req.params.id);
  res.json({ artist, tracks });
});