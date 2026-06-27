/**
 * Debug endpoints — for production troubleshooting without exposing secrets.
 *
 * GET /api/debug/env           — returns which critical env vars are set (boolean only)
 * GET /api/debug/llm           — pings the configured LLM and returns the error
 * GET /api/debug/circle        — pings Circle sandbox endpoints
 * GET /api/debug/circle-setup  — DCW setup helper: returns whether entity secret + wallet set are configured
 * POST /api/debug/circle-setup — DCW setup helper: register entity secret + create wallet set
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../services/llm.js';
import {
  getEntityPublicKey,
  registerEntitySecret,
  createWalletSet,
} from '../services/circle-dcw.js';

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

/**
 * Test LLM with a specific base URL. Useful when the configured URL fails.
 * GET /api/debug/llm-test?base=https://api.minimax.chat/v1&model=MiniMax-M3
 * Uses the same LLM_API_KEY. Returns the full request/response for diagnosis.
 */
debugRouter.get('/llm-test', async (req, res) => {
  const apiKey = process.env.LLM_API_KEY ?? '';
  if (!apiKey) return res.status(503).json({ ok: false, error: 'LLM_API_KEY unset' });
  const base = String(req.query.base ?? '');
  const model = String(req.query.model ?? 'MiniMax-M3');
  if (!base) return res.status(400).json({ ok: false, error: '?base=... required' });

  const results: any = { base, model, attempts: [] };
  const candidates = ['/chat/completions', '/v1/chat/completions'];
  for (const path of candidates) {
    const url = base.endsWith('/') ? `${base.replace(/\/$/, '')}${path === '/v1/chat/completions' ? path : path}` : `${base}${path === '/v1/chat/completions' ? path : '/chat/completions'}`;
    // Simpler: try the explicit URL
    const tryUrl = base.includes('chat/completions') ? base : `${base.replace(/\/$/, '')}/chat/completions`;
    try {
      const r = await fetch(tryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
      });
      const text = await r.text();
      results.attempts.push({ url: tryUrl, status: r.status, body: text.slice(0, 400) });
      if (r.ok) {
        results.ok = true;
        results.workingUrl = tryUrl;
        break;
      }
    } catch (e: any) {
      results.attempts.push({ url: tryUrl, error: e?.message ?? String(e) });
    }
  }
  res.json(results);
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

/**
 * DCW setup helper. Tells you whether entity secret + wallet set are configured.
 *
 * If CIRCLE_ENTITY_SECRET is set but not registered, the response includes instructions.
 * If CIRCLE_WALLET_SET_ID is not set, you can POST to this endpoint to:
 *   - register the entity secret with Circle (one-time)
 *   - create a wallet set (one-time)
 *
 * The wallet set ID is returned in the response so you can paste it into Railway.
 */
debugRouter.get('/circle-setup', async (_req, res) => {
  const hasKey = !!process.env.CIRCLE_API_KEY;
  const hasAppId = !!process.env.CIRCLE_APP_ID;
  const hasEntitySecret = !!process.env.CIRCLE_ENTITY_SECRET;
  const hasWalletSetId = !!process.env.CIRCLE_WALLET_SET_ID;
  res.json({
    CIRCLE_API_KEY: hasKey,
    CIRCLE_APP_ID: hasAppId,
    CIRCLE_ENTITY_SECRET: hasEntitySecret ? 'set' : 'NOT SET',
    CIRCLE_WALLET_SET_ID: hasWalletSetId ? 'set' : 'NOT SET',
    ready: hasKey && hasAppId && hasEntitySecret && hasWalletSetId,
    instructions: !hasEntitySecret
      ? '1. Generate entity secret at console.circle.com -> your app -> Developer-Controlled Wallets. Paste as CIRCLE_ENTITY_SECRET env var.'
      : !hasWalletSetId
      ? '2. POST /api/debug/circle-setup with body { "action": "create_wallet_set", "name": "Pazzera Users" } to create the wallet set.'
      : 'Setup complete. Email-auth flow will now use Circle for OTP.',
  });
});

debugRouter.post('/circle-setup', async (req, res) => {
  const body = req.body ?? {};
  const action = String(body.action ?? '');

  if (action === 'register_entity_secret') {
    const secret = process.env.CIRCLE_ENTITY_SECRET;
    if (!secret) return res.status(400).json({ error: 'CIRCLE_ENTITY_SECRET env var must be set first' });
    const r = await registerEntitySecret(secret);
    return res.json(r);
  }

  if (action === 'create_wallet_set') {
    const name = String(body.name ?? 'Pazzera Users');
    if (!process.env.CIRCLE_ENTITY_SECRET) {
      return res.status(400).json({ error: 'CIRCLE_ENTITY_SECRET must be set first' });
    }
    const r = await createWalletSet(name);
    if (r.ok && r.data?.walletSet?.id) {
      return res.json({
        ...r,
        hint: `Set this as CIRCLE_WALLET_SET_ID on Railway: ${r.data.walletSet.id}`,
        walletSetId: r.data.walletSet.id,
      });
    }
    return res.json(r);
  }

  return res.status(400).json({
    error: 'unknown action',
    validActions: ['register_entity_secret', 'create_wallet_set'],
  });
});