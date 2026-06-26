// Pazzera — public stats endpoints
// Powers the "listening now" pill, artist dashboard charts, and homepage counters.

import { Router } from 'express';
import { getDb } from '../db.js';

export const statsRouter = Router();

// ============ ACTIVE LISTENERS (last 60s of plays) ============
statsRouter.get('/listening-now', (_req, res) => {
  const db = getDb();
  // Active = plays table entries where created_at is within the last 60 seconds
  const sixtySecondsAgo = Date.now() - 60_000;
  const row = db.prepare(`
    SELECT COUNT(DISTINCT fan_user_id) AS count
    FROM plays
    WHERE created_at > ? AND skipped = 0
  `).get(sixtySecondsAgo) as { count: number };
  res.json({ count: row.count });
});

// ============ PLATFORM TOTALS ============
statsRouter.get('/platform', (_req, res) => {
  const db = getDb();
  const tracks = (db.prepare('SELECT COUNT(*) AS c FROM tracks WHERE published = 1').get() as any).c;
  const artists = (db.prepare('SELECT COUNT(*) AS c FROM artists').get() as any).c;
  const plays = (db.prepare('SELECT COUNT(*) AS c FROM plays WHERE skipped = 0').get() as any).c;
  const settled = (db.prepare("SELECT COALESCE(SUM(charged_usdc), '0') AS s FROM plays WHERE settled = 1").get() as any).s;
  res.json({
    tracks_published: tracks,
    artists,
    total_plays: plays,
    total_settled_usdc: settled,
  });
});

// ============ ARTIST STATS ============
statsRouter.get('/artist/:id', (req, res) => {
  const db = getDb();
  const id = req.params.id;
  const tracks = db.prepare('SELECT id, plays_count, earnings_usdc FROM tracks WHERE artist_id = ?').all(id) as any[];
  if (tracks.length === 0) {
    return res.json({
      total_plays: 0,
      total_earnings_usdc: '0',
      listeners: 0,
      track_count: 0,
    });
  }
  const total_plays = tracks.reduce((s, t) => s + (t.plays_count || 0), 0);
  const total_earnings_usdc = tracks.reduce((s, t) => s + Number(t.earnings_usdc || 0), 0).toFixed(6);
  const listeners = (db.prepare(`
    SELECT COUNT(DISTINCT p.fan_user_id) AS c
    FROM plays p JOIN tracks t ON t.id = p.track_id
    WHERE t.artist_id = ? AND p.skipped = 0
  `).get(id) as any).c;
  res.json({
    total_plays,
    total_earnings_usdc,
    listeners,
    track_count: tracks.length,
  });
});

// ============ TRACK STATS ============
statsRouter.get('/track/:id', (req, res) => {
  const db = getDb();
  const track = db.prepare('SELECT id, plays_count, earnings_usdc FROM tracks WHERE id = ?').get(req.params.id) as any;
  if (!track) return res.status(404).json({ error: 'track not found' });
  const sixtySecondsAgo = Date.now() - 60_000;
  const listeners_now = (db.prepare(`
    SELECT COUNT(DISTINCT fan_user_id) AS c FROM plays WHERE track_id = ? AND created_at > ?
  `).get(req.params.id, sixtySecondsAgo) as any).c;
  res.json({
    plays: track.plays_count || 0,
    earnings_usdc: track.earnings_usdc || '0',
    listeners_now,
  });
});

// ============ FEATURED ARTISTS (for homepage) ============
statsRouter.get('/featured-artists', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT a.id, u.display_name,
           (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = a.id AND t.published = 1) AS track_count,
           (SELECT COALESCE(SUM(plays_count), 0) FROM tracks t WHERE t.artist_id = a.id) AS total_plays
    FROM artists a
    JOIN users u ON u.id = a.user_id
    ORDER BY total_plays DESC, a.created_at DESC
    LIMIT 24
  `).all();
  res.json({ artists: rows });
});
