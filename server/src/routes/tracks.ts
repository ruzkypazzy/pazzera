import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';

export const tracksRouter = Router();

// GET /api/tracks — public catalog
tracksRouter.get('/', (req, res) => {
  const db = getDb();
  const artistId = typeof req.query.artistId === 'string' ? req.query.artistId : null;
  const sql = artistId
    ? `SELECT t.*, a.display_name as artist_name, a.wallet_address as artist_wallet
       FROM tracks t JOIN artists a ON a.id = t.artist_id
       WHERE t.published = 1 AND t.artist_id = ?
       ORDER BY t.created_at DESC`
    : `SELECT t.*, a.display_name as artist_name, a.wallet_address as artist_wallet
       FROM tracks t JOIN artists a ON a.id = t.artist_id
       WHERE t.published = 1
       ORDER BY t.created_at DESC`;
  const rows = artistId ? db.prepare(sql).all(artistId) : db.prepare(sql).all();
  res.json({ tracks: rows });
});

// GET /api/tracks/:id — single track detail
tracksRouter.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT t.*, a.display_name as artist_name, a.wallet_address as artist_wallet
    FROM tracks t JOIN artists a ON a.id = t.artist_id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'track not found' });
  res.json({ track: row });
});

// POST /api/tracks — artist uploads a track (artist auth required)
// Body: { artistId, title, description, audioUrl, coverUrl, durationSeconds, pricePerListenUsdc? }
tracksRouter.post('/', (req, res) => {
  const db = getDb();
  const body = req.body ?? {};
  const required = ['artistId', 'title', 'audioUrl', 'durationSeconds'];
  for (const k of required) {
    if (!body[k]) return res.status(400).json({ error: `missing field: ${k}` });
  }
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO tracks (id, artist_id, title, description, audio_url, cover_url,
                        duration_seconds, price_per_listen_usdc, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.artistId,
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