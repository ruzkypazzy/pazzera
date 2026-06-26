import { Router } from 'express';
import { getDb } from '../db.js';
import { optionalAuth } from '../services/auth.js';

export const artistsRouter = Router();

// Public catalog of artists
artistsRouter.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT a.id, u.display_name, a.bio,
           (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = a.id AND t.published = 1) AS track_count,
           (SELECT COALESCE(SUM(plays_count), 0) FROM tracks t WHERE t.artist_id = a.id) AS plays_count
    FROM artists a
    JOIN users u ON u.id = a.user_id
    ORDER BY plays_count DESC, a.created_at DESC
    LIMIT 50
  `).all();
  res.json({ artists: rows });
});

// Public artist profile
artistsRouter.get('/:id', optionalAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT a.id, a.bio, a.created_at,
           u.id as user_id, u.display_name, u.email,
           w.address as wallet_address
    FROM artists a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN wallets w ON w.user_id = u.id
    WHERE a.id = ?
  `).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'artist not found' });
  const tracks = db.prepare('SELECT * FROM tracks WHERE artist_id = ? AND published = 1 ORDER BY created_at DESC').all(req.params.id);
  res.json({ artist: row, tracks });
});