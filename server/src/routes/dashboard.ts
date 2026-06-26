import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../services/auth.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', requireAuth, (req, res) => {
  const session = (req as any).session;
  const db = getDb();
  const artist = db.prepare('SELECT id FROM artists WHERE user_id = ?').get(session.userId) as any;
  if (!artist) return res.status(404).json({ error: 'not an artist' });

  const user = db.prepare('SELECT id, display_name, email FROM users WHERE id = ?').get(session.userId);
  const wallet = db.prepare('SELECT address FROM wallets WHERE user_id = ?').get(session.userId);

  const tracks = db.prepare(`
    SELECT id, title, audio_url, cover_url, duration_seconds,
           price_per_listen_usdc, plays_count, earnings_usdc, created_at
    FROM tracks WHERE artist_id = ? ORDER BY created_at DESC
  `).all(artist.id) as any[];

  const totalPlays = tracks.reduce((s, t) => s + t.plays_count, 0);
  const totalEarnings = tracks.reduce((s, t) => s + Number(t.earnings_usdc), 0);

  const recentPlays = db.prepare(`
    SELECT p.id, p.fan_wallet_address, p.charged_usdc, p.settlement_id, p.created_at, t.title as track_title
    FROM plays p JOIN tracks t ON t.id = p.track_id
    WHERE t.artist_id = ? AND p.settled = 1
    ORDER BY p.created_at DESC LIMIT 30
  `).all(artist.id);

  res.json({
    artist: { ...artist, ...(user as object) },
    wallet,
    tracks,
    totals: { plays: totalPlays, earningsUsdc: totalEarnings.toFixed(6) },
    recentPlays,
  });
});