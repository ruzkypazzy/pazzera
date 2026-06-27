/**
 * Agent routes — Fan Agent chat, Fan Agent preferences, agent history.
 *
 * POST /api/agent/chat       — fan sends a request, agent plays + pays
 * GET  /api/agent/profile    — get fan agent preferences + budget
 * PATCH /api/agent/profile   — update preferences, budgets, enable/disable
 * GET  /api/agent/history    — recent agent runs for this user (audit trail)
 */
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { decryptString } from '../services/crypto.js';
import { requireAuth } from '../services/auth.js';
import {
  runFanAgent,
  getFanProfile,
  setFanPreferences,
} from '../services/agent/fan-agent.js';

export const agentRouter = Router();
agentRouter.use(requireAuth);

const chatSchema = z.object({
  message: z.string().min(1).max(1000),
});

agentRouter.post('/chat', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid body' });
  const session = (req as any).session;
  const userId = session.userId;

  try {
    const result = await runFanAgent({
      userId,
      userMessage: parsed.data.message,
    });
    res.json(result);
  } catch (e: any) {
    console.error('[agent/chat] error:', e);
    res.status(500).json({ error: e?.message ?? 'agent failed' });
  }
});

agentRouter.get('/profile', async (req, res) => {
  const session = (req as any).session;
  const profile = getFanProfile(session.userId);
  res.json({
    ...profile,
    preferences: JSON.parse(profile.preferences),
  });
});

const updateProfileSchema = z.object({
  preferences: z.record(z.unknown()).optional(),
  budgetPerSessionUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  budgetPerDayUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  enabled: z.boolean().optional(),
});

agentRouter.patch('/profile', async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid body' });
  const session = (req as any).session;
  const profile = setFanPreferences({
    userId: session.userId,
    ...parsed.data,
  });
  res.json({
    ...profile,
    preferences: JSON.parse(profile.preferences),
  });
});

agentRouter.get('/history', async (req, res) => {
  const session = (req as any).session;
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, agent_type, input, output, tokens_used, duration_ms, status, created_at
    FROM agent_runs
    WHERE user_id = ? AND agent_type IN ('fan', 'curator')
    ORDER BY created_at DESC
    LIMIT 50
  `).all(session.userId);
  res.json({ runs: rows });
});