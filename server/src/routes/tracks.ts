import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { optionalAuth, requireAuth } from '../services/auth.js';

export const tracksRouter = Router();

// Public catalog
tracksRouter.get('/', optionalAuth, (req, res) => {
  const db = getDb();
  const artistId = typeof req.query.artistId === 'string' ? req.query.artistId : null;
  const sql = artistId
    ? `SELECT t.*, u.display_name as artist_name, w.address as artist_wallet
       FROM tracks t
       JOIN artists a ON a.id = t.artist_id
       JOIN users u ON u.id = a.user_id
       JOIN wallets w ON w.user_id = u.id
       WHERE t.published = 1 AND t.artist_id = ?
       ORDER BY t.created_at DESC`
    : `SELECT t.*, u.display_name as artist_name, w.address as artist_wallet
       FROM tracks t
       JOIN artists a ON a.id = t.artist_id
       JOIN users u ON u.id = a.user_id
       JOIN wallets w ON w.user_id = u.id
       WHERE t.published = 1
       ORDER BY t.created_at DESC`;
  const rows = artistId ? db.prepare(sql).all(artistId) : db.prepare(sql).all();
  res.json({ tracks: rows });
});

// Single track detail
tracksRouter.get('/:id', optionalAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT t.*, u.display_name as artist_name, w.address as artist_wallet
    FROM tracks t
    JOIN artists a ON a.id = t.artist_id
    JOIN users u ON u.id = a.user_id
    JOIN wallets w ON w.user_id = u.id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'track not found' });
  res.json({ track: row });
});

// Upload (artist auth)
tracksRouter.post('/', requireAuth, (req, res) => {
  const session = (req as any).session;
  if (session.role !== 'artist') return res.status(403).json({ error: 'artist role required' });

  const db = getDb();
  const body = req.body ?? {};
  const required = ['title', 'audioUrl', 'durationSeconds'];
  for (const k of required) {
    if (!body[k]) return res.status(400).json({ error: `missing field: ${k}` });
  }
  const artist = db.prepare('SELECT id FROM artists WHERE user_id = ?').get(session.userId) as any;
  if (!artist) return res.status(404).json({ error: 'artist profile not found' });

  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO tracks (id, artist_id, title, description, audio_url, cover_url,
                        duration_seconds, price_per_listen_usdc, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    artist.id,
    body.title,
    body.description ?? null,
    body.audioUrl,
    body.coverUrl ?? null,
    Number(body.durationSeconds),
    body.pricePerListenUsdc ?? '0.001',
    now,
  );
  res.json({ id, ok: true });
});