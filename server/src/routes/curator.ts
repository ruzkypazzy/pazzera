/**
 * Curator Agent routes — submission + review endpoints.
 *
 * POST   /api/curator/submit        — artist submits a track (goes to queue)
 * GET    /api/curator/submissions   — list artist's own submissions
 * POST   /api/curator/review/:id    — trigger Curator Agent (artist or admin)
 * GET    /api/curator/queue         — admin: all pending submissions
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { requireAuth } from '../services/auth.js';
import { reviewSubmission } from '../services/agent/curator-agent.js';

export const curatorRouter = Router();
curatorRouter.use(requireAuth);

const submitSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  audioUrl: z.string().url(),
  coverUrl: z.string().url().optional(),
  durationSeconds: z.number().int().min(1).max(60 * 60),
  suggestedTags: z.array(z.string().max(50)).max(20).optional(),
  pricePerListenUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  coArtists: z.array(z.object({
    email: z.string().email(),
    role: z.enum(['producer', 'featured', 'songwriter']),
    shareBps: z.number().int().min(0).max(10000),
  })).optional(),
});

curatorRouter.post('/submit', async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  const session = (req as any).session;
  const db = getDb();

  // Must be an artist
  const artist = db.prepare(`SELECT * FROM artists WHERE user_id = ?`).get(session.userId) as any;
  if (!artist) return res.status(403).json({ error: 'only artists can submit tracks' });

  const submissionId = randomUUID();
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pending_submissions (
        id, artist_user_id, artist_id, title, description,
        audio_url, cover_url, duration_seconds,
        suggested_tags, price_per_listen_usdc,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      submissionId,
      session.userId,
      artist.id,
      parsed.data.title,
      parsed.data.description ?? null,
      parsed.data.audioUrl,
      parsed.data.coverUrl ?? null,
      parsed.data.durationSeconds,
      parsed.data.suggestedTags ? JSON.stringify(parsed.data.suggestedTags) : null,
      parsed.data.pricePerListenUsdc ?? null,
      now,
    );

    // If co-artists specified, store them as a pre-submission split config hint
    // (The Curator Agent may override these on approval; the artist can also
    // edit them on their dashboard after approval.)
    if (parsed.data.coArtists && parsed.data.coArtists.length > 0) {
      // Co-artists need to exist in the system. Look them up by email.
      for (const co of parsed.data.coArtists) {
        const u = db.prepare(`SELECT id FROM users WHERE email = ?`).get(co.email) as any;
        if (u) {
          // Mark as intent for the artist to confirm in dashboard after Curator approval.
          // We don't write to track_royalty_splits yet (no track exists).
          db.prepare(`
            INSERT INTO agent_runs (id, agent_type, user_id, input, output, created_at)
            VALUES (?, 'curator', ?, ?, ?, ?)
          `).run(
            randomUUID(),
            session.userId,
            JSON.stringify({ coArtistEmail: co.email, role: co.role, shareBps: co.shareBps }),
            `Co-artist declared for submission ${submissionId}`,
            now,
          );
        }
      }
    }
  });
  tx();

  // Trigger Curator Agent asynchronously (don't block the response)
  reviewSubmission(submissionId).catch((e) => {
    console.error('[curator/submit] async review failed:', e);
  });

  res.json({
    submissionId,
    status: 'pending',
    message: 'Submission queued. Curator Agent will review shortly.',
  });
});

curatorRouter.get('/submissions', async (req, res) => {
  const session = (req as any).session;
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, title, status, rejection_reason, curator_notes, curator_tags,
           curator_price_usdc, track_id, reviewed_at, created_at
    FROM pending_submissions
    WHERE artist_user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(session.userId);
  res.json({
    submissions: rows.map((r: any) => ({
      ...r,
      curator_tags: r.curator_tags ? JSON.parse(r.curator_tags) : null,
    })),
  });
});

curatorRouter.post('/review/:id', async (req, res) => {
  const session = (req as any).session;
  const db = getDb();
  const sub = db.prepare(`SELECT * FROM pending_submissions WHERE id = ?`).get(req.params.id) as any;
  if (!sub) return res.status(404).json({ error: 'submission not found' });
  if (sub.artist_user_id !== session.userId) {
    // Admin override possible — check session.role
    if (session.role !== 'admin') {
      return res.status(403).json({ error: 'not your submission' });
    }
  }

  try {
    const result = await reviewSubmission(req.params.id);
    res.json(result);
  } catch (e: any) {
    console.error('[curator/review] error:', e);
    res.status(500).json({ error: e?.message ?? 'review failed' });
  }
});

curatorRouter.get('/queue', async (req, res) => {
  const session = (req as any).session;
  if (session.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM pending_submissions
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 100
  `).all();
  res.json({ submissions: rows });
});