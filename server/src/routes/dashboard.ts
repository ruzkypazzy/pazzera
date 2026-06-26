import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../services/auth.js';

export const dashboardRouter = Router();

dashboardRouter.get('/artist', requireAuth, (req, res) => {
  const session = (req as any).session;
  const db = getDb();
  const artist = db.prepare('SELECT id FROM artists WHERE user_id = ?').get(session.userId) as any;
  if (!artist) return res.status(404).json({ error: 'not an artist' });

  const tracks = db.prepare(`
    SELECT id, title, audio_url, cover_url, duration_seconds,
           price_per_listen_usdc, plays_count, earnings_usdc, created_at, published
    FROM tracks WHERE artist_id = ? ORDER BY created_at DESC
  `).all(artist.id) as any[];

  const total_plays = tracks.reduce((s, t) => s + (t.plays_count || 0), 0);
  const total_earnings = tracks.reduce((s, t) => s + Number(t.earnings_usdc || 0), 0).toFixed(6);

  // 24h deltas
  const dayAgo = Date.now() - 86_400_000;
  const plays_24h = (db.prepare(`
    SELECT COUNT(*) AS c FROM plays p
    JOIN tracks t ON t.id = p.track_id
    WHERE t.artist_id = ? AND p.created_at > ? AND p.skipped = 0
  `).get(artist.id, dayAgo) as any).c;
  const earnings_24h = (db.prepare(`
    SELECT COALESCE(SUM(p.charged_usdc), '0') AS s FROM plays p
    JOIN tracks t ON t.id = p.track_id
    WHERE t.artist_id = ? AND p.created_at > ? AND p.settled = 1
  `).get(artist.id, dayAgo) as any).s;

  // Listening now (any of this artist's tracks)
  const sixtySecAgo = Date.now() - 60_000;
  const listening_now = (db.prepare(`
    SELECT COUNT(DISTINCT p.fan_user_id) AS c FROM plays p
    JOIN tracks t ON t.id = p.track_id
    WHERE t.artist_id = ? AND p.created_at > ?
  `).get(artist.id, sixtySecAgo) as any).c;

  // Earnings series — last 14 days, bucketed by day
  const earnings_series: { label: string; value: string }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = dayStart.getTime() + 86_400_000;
    const sum = (db.prepare(`
      SELECT COALESCE(SUM(p.charged_usdc), '0') AS s FROM plays p
      JOIN tracks t ON t.id = p.track_id
      WHERE t.artist_id = ? AND p.settled = 1 AND p.created_at >= ? AND p.created_at < ?
    `).get(artist.id, dayStart.getTime(), dayEnd) as any).s;
    const label = `${dayStart.getMonth() + 1}/${dayStart.getDate()}`;
    earnings_series.push({ label, value: Number(sum).toFixed(6) });
  }

  // Top tracks (sorted by plays)
  const top_tracks = [...tracks]
    .sort((a, b) => (b.plays_count || 0) - (a.plays_count || 0))
    .slice(0, 5);

  res.json({
    kpis: {
      total_plays,
      total_earnings,
      plays_24h,
      earnings_24h,
      listening_now,
    },
    earnings_series,
    tracks,
    top_tracks,
  });
});

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

  const totalPlays = tracks.reduce((s, t) => s + (t.plays_count || 0), 0);
  const totalEarnings = tracks.reduce((s, t) => s + Number(t.earnings_usdc || 0), 0);

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
