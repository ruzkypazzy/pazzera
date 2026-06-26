import { Router } from 'express';
import { getDb } from '../db.js';

export const adminRouter = Router();

// GET /api/admin/stats — hackathon demo stats (anonymous aggregate)
adminRouter.get('/stats', (_req, res) => {
  const db = getDb();
  const artists = (db.prepare('SELECT COUNT(*) as c FROM artists').get() as any).c;
  const tracks = (db.prepare('SELECT COUNT(*) as c FROM tracks').get() as any).c;
  const plays = (db.prepare('SELECT COUNT(*) as c FROM plays').get() as any).c;
  const settledPlays = (db.prepare('SELECT COUNT(*) as c FROM plays WHERE settled = 1').get() as any).c;
  const totalUsdc = (db.prepare(`SELECT COALESCE(SUM(CAST(charged_usdc AS REAL)), 0) as s FROM plays WHERE settled = 1`).get() as any).s;
  res.json({ artists, tracks, plays, settledPlays, totalUsdc });
});