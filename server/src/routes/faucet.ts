/**
 * Faucet routes — claim testnet USDC for the fan wallet.
 *
 * POST /api/faucet/claim   — request testnet tokens for the user's wallet
 * GET  /api/faucet/status  — last claim + remaining daily allowance
 *
 * For Arc Testnet, Circle's faucet (https://faucet.circle.com) is the source.
 * The Circle W3S SDK exposes requestTestnetTokens() which we delegate to.
 *
 * NOTE: this only works for SCA (smart contract account) wallets — Circle's
 * testnet faucet funds SCA wallets on supported chains. Arc testnet is in
 * the SCA list per Canteen docs.
 */
import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../services/auth.js';
import { audit } from '../services/audit.js';
import { getUsdcBalance } from '../services/arc.js';
import { randomUUID } from 'node:crypto';

export const faucetRouter = Router();
faucetRouter.use(requireAuth);

const DAILY_LIMIT_USDC = 5;          // hard cap per user per day
const MIN_HOURS_BETWEEN_CLAIMS = 1;  // throttling per user
const FAUCET_AMOUNT_USDC = 1;        // typical faucet drip

interface CircleFaucetResult {
  ok: boolean;
  txHash?: string;
  message?: string;
  error?: string;
}

async function callCircleFaucet(address: string): Promise<CircleFaucetResult> {
  const apiKey = process.env.CIRCLE_API_KEY ?? '';
  const baseUrl = process.env.CIRCLE_BASE_URL ?? 'https://api.circle.com';
  if (!apiKey) {
    return { ok: false, error: 'CIRCLE_API_KEY not configured' };
  }
  try {
    // Circle Faucet API: POST /v1/faucet/drips
    const r = await fetch(`${baseUrl}/v1/faucet/drips`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        address,
        blockchain: 'ARC-TESTNET',
        usdc: true,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      return { ok: false, error: `Circle faucet ${r.status}: ${text.slice(0, 300)}` };
    }
    const json = (await r.json()) as any;
    return {
      ok: true,
      txHash: json?.data?.txHash ?? json?.txHash,
      message: json?.data?.message ?? 'Tokens sent',
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

faucetRouter.post('/claim', async (req, res) => {
  const session = (req as any).session;
  const db = getDb();
  const wallet = db.prepare(`
    SELECT id, address, pin_setup_complete FROM wallets WHERE user_id = ?
  `).get(session.userId) as any;

  if (!wallet) {
    return res.status(400).json({ error: 'no wallet — complete PIN setup first' });
  }
  if (!wallet.pin_setup_complete) {
    return res.status(400).json({ error: 'wallet not ready — complete PIN setup first' });
  }
  if (!wallet.address || wallet.address === 'pending') {
    return res.status(400).json({ error: 'wallet address not yet known — complete PIN setup' });
  }

  // Throttle
  const last = db.prepare(`
    SELECT created_at FROM faucet_claims WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(session.userId) as any;
  if (last) {
    const hoursAgo = (Date.now() - last.created_at) / (60 * 60 * 1000);
    if (hoursAgo < MIN_HOURS_BETWEEN_CLAIMS) {
      return res.status(429).json({
        error: `wait ${MIN_HOURS_BETWEEN_CLAIMS - hoursAgo < 0.05 ? 'a few minutes' : Math.ceil((MIN_HOURS_BETWEEN_CLAIMS - hoursAgo) * 60) + ' minutes'} before next claim`,
      });
    }
  }

  // Daily cap
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayClaims = db.prepare(`
    SELECT COUNT(*) as c FROM faucet_claims
    WHERE user_id = ? AND created_at >= ?
  `).get(session.userId, today.getTime()) as any;
  if (todayClaims.c >= 3) {
    return res.status(429).json({ error: 'daily limit reached — try again tomorrow' });
  }

  // Get current balance for the "before/after" UI
  let beforeBalance = '0';
  try {
    beforeBalance = await getUsdcBalance(wallet.address);
  } catch {}

  // Call Circle faucet
  const result = await callCircleFaucet(wallet.address);

  // Record the attempt (success or fail)
  db.prepare(`
    INSERT INTO faucet_claims (id, user_id, address, amount_usdc, tx_hash, success, error, before_balance_usdc, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    session.userId,
    wallet.address,
    FAUCET_AMOUNT_USDC,
    result.txHash ?? null,
    result.ok ? 1 : 0,
    result.error ?? null,
    beforeBalance,
    Date.now(),
  );

  audit(req, 'faucet_claim', {
    userId: session.userId,
    address: wallet.address,
    metadata: { ok: result.ok, error: result.error },
  });

  if (!result.ok) {
    return res.status(502).json({
      error: 'faucet request failed',
      detail: result.error,
      message: 'If Circle faucet is rate-limited, try again in a few minutes or visit https://faucet.circle.com directly.',
      faucetUrl: 'https://faucet.circle.com',
    });
  }

  res.json({
    ok: true,
    address: wallet.address,
    amountUsdc: FAUCET_AMOUNT_USDC,
    txHash: result.txHash,
    message: result.message ?? 'Tokens sent. Check your wallet in ~30s.',
    faucetUrl: 'https://faucet.circle.com',
  });
});

faucetRouter.get('/status', async (req, res) => {
  const session = (req as any).session;
  const db = getDb();
  const last = db.prepare(`
    SELECT * FROM faucet_claims WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(session.userId) as any;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = (db.prepare(`
    SELECT COUNT(*) as c FROM faucet_claims
    WHERE user_id = ? AND created_at >= ? AND success = 1
  `).get(session.userId, today.getTime()) as any).c;

  const wallet = db.prepare(`
    SELECT address, pin_setup_complete FROM wallets WHERE user_id = ?
  `).get(session.userId) as any;

  let balance = '0';
  if (wallet?.address && wallet.address !== 'pending') {
    try { balance = await getUsdcBalance(wallet.address); } catch {}
  }

  res.json({
    ready: !!wallet?.pin_setup_complete && wallet?.address && wallet.address !== 'pending',
    address: wallet?.address,
    balanceUsdc: balance,
    dailyRemaining: Math.max(0, 3 - todayCount),
    dailyLimit: 3,
    lastClaim: last ?? null,
  });
});