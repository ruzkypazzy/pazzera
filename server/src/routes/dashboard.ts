import { Router } from 'express';
import { getDb } from '../db.js';

export const dashboardRouter = Router();

// GET /api/dashboard/:artistId — artist's earnings + plays
dashboardRouter.get('/:artistId', (req, res) => {
  const db = getDb();
  const artist = db.prepare('SELECT id, display_name, email, wallet_address FROM artists WHERE id = ?').get(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'artist not found' });

  const tracks = db.prepare(`
    SELECT id, title, audio_url, cover_url, duration_seconds,
           price_per_listen_usdc, plays_count, earnings_usdc, created_at
    FROM tracks WHERE artist_id = ? ORDER BY created_at DESC
  `).all(req.params.artistId) as any[];

  const totalPlays = tracks.reduce((s, t) => s + t.plays_count, 0);
  const totalEarnings = tracks.reduce((s, t) => s + Number(t.earnings_usdc), 0);

  const recentPlays = db.prepare(`
    SELECT p.id, p.fan_wallet_address, p.charged_usdc, p.settlement_tx_hash, p.created_at, t.title as track_title
    FROM plays p JOIN tracks t ON t.id = p.track_id
    WHERE t.artist_id = ? AND p.settled = 1
    ORDER BY p.created_at DESC LIMIT 30
  `).all(req.params.artistId);

  res.json({
    artist,
    tracks,
    totals: { plays: totalPlays, earningsUsdc: totalEarnings.toFixed(6) },
    recentPlays,
  });
});