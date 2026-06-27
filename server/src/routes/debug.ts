/**
 * Debug endpoints — for production troubleshooting without exposing secrets.
 *
 * GET /api/debug/env    — returns which critical env vars are set (boolean only)
 * GET /api/debug/llm    — pings the configured LLM and returns the error
 * GET /api/debug/circle — pings Circle sandbox endpoints
 */
import { Router } from 'express';
import { getConfig } from '../services/llm.js';

export const debugRouter = Router();

debugRouter.get('/env', (_req, res) => {
  const checks = {
    CIRCLE_API_KEY: !!process.env.CIRCLE_API_KEY,
    CIRCLE_APP_ID: !!process.env.CIRCLE_APP_ID,
    ARC_RPC_URL: !!process.env.ARC_RPC_URL,
    JWT_SECRET: !!process.env.JWT_SECRET,
    ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
    LLM_API_KEY: !!process.env.LLM_API_KEY,
    LLM_BASE_URL: process.env.LLM_BASE_URL ?? '(default: https://api.freemodel.dev/v1)',
    LLM_MODEL: process.env.LLM_MODEL ?? '(default: gpt-4o-mini)',
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? '(unset)',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? '(defaults applied)',
    DB_PATH: process.env.DB_PATH ?? '(default)',
    NODE_ENV: process.env.NODE_ENV ?? '(unset)',
  };
  res.json({ ok: true, env: checks });
});

debugRouter.get('/llm', async (_req, res) => {
  try {
    const { apiKey, baseUrl, model } = getConfig();
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'LLM_API_KEY is not set on Railway Variables' });
    }
    // Try a tiny completion
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
        max_tokens: 10,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({
        ok: false,
        status: r.status,
        model,
        baseUrl,
        error: text.slice(0, 500),
      });
    }
    const json = (await r.json()) as any;
    res.json({
      ok: true,
      model,
      baseUrl,
      reply: json.choices?.[0]?.message?.content ?? '(empty)',
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

debugRouter.get('/circle', async (_req, res) => {
  const apiKey = process.env.CIRCLE_API_KEY ?? '';
  const result: any = { hasKey: !!apiKey, keyLength: apiKey.length };
  if (!apiKey) return res.json({ ok: false, ...result, error: 'CIRCLE_API_KEY missing' });
  try {
    // Ping config endpoint (cheapest, no side effects)
    const r = await fetch(`https://api.circle.com/v1/w3s/config/entity`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    result.pingStatus = r.status;
    if (!r.ok) {
      const text = await r.text();
      result.error = text.slice(0, 300);
    } else {
      result.ok = true;
    }
  } catch (e: any) {
    result.error = e?.message ?? String(e);
  }
  res.json(result);
});