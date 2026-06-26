import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import {
  verifyX402Payment,
  submitToGateway,
  getSettlementStatus,
  usdcUnits,
  formatUsdc,
  NETWORK_ID,
  ARC_EXPLORER,
} from '../services/circle.js';
import { requireAuth } from '../services/auth.js';

export const playRouter = Router();

const ARC_USDC = process.env.ARC_USDC_CONTRACT ?? '0x3600000000000000000000000000000000000000';

// All play routes require an authenticated user.
playRouter.use(requireAuth);

// ─── Start play → x402 challenge (HTTP 402) ────────────────
playRouter.post('/start', async (req, res) => {
  const { trackId } = req.body ?? {};
  const session = (req as any).session;
  if (!trackId) return res.status(400).json({ error: 'trackId required' });

  const db = getDb();
  const track = db.prepare('SELECT * FROM tracks WHERE id = ? AND published = 1').get(trackId) as any;
  if (!track) return res.status(404).json({ error: 'track not found' });

  const artist = db.prepare(`
    SELECT a.*, u.display_name, w.address as wallet_address
    FROM artists a
    JOIN users u ON u.id = a.user_id
    JOIN wallets w ON w.user_id = a.user_id
    WHERE a.id = ?
  `).get(track.artist_id) as any;
  if (!artist || !artist.wallet_address) return res.status(404).json({ error: 'artist wallet not provisioned' });

  // Skip gate 1: replay cooldown
  const recent = db.prepare(`
    SELECT created_at FROM plays WHERE track_id = ? AND fan_user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(trackId, session.userId) as any;

  const now = Date.now();
  if (recent && now - recent.created_at < track.replay_cooldown_seconds * 1000) {
    return res.json({
      track,
      artist: { id: artist.id, display_name: artist.display_name, wallet_address: artist.wallet_address },
      skip: true,
      reason: 'replay_cooldown',
      replayAt: recent.created_at + track.replay_cooldown_seconds * 1000,
    });
  }

  // Build x402 challenge — EIP-712 TransferWithAuthorization
  const value = usdcUnits(track.price_per_listen_usdc);
  const nonce = '0x' + randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64);
  const validAfter = Math.floor(now / 1000);
  const validBefore = validAfter + 300; // 5 min

  res.json({
    track,
    artist: { id: artist.id, display_name: artist.display_name, wallet_address: artist.wallet_address },
    skip: false,
    challenge: {
      network: NETWORK_ID,
      usdcContract: ARC_USDC,
      payer: session.email,           // frontend resolves to wallet address
      payee: artist.wallet_address,
      value,
      valueUsdc: track.price_per_listen_usdc,
      validAfter,
      validBefore,
      nonce,
      eip712: {
        domain: { name: 'USDC', version: '2', chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002), verifyingContract: ARC_USDC },
        types: {
          TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',          type: 'address' },
            { name: 'value',       type: 'uint256' },
            { name: 'validAfter',  type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce',       type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: '{{PAYER_ADDRESS}}',     // frontend fills in
          to: artist.wallet_address,
          value,
          validAfter,
          validBefore,
          nonce,
        },
      },
    },
  });
});

// ─── Confirm play → verify EIP-712, submit to Gateway ──────
playRouter.post('/confirm', async (req, res) => {
  const parsed = z.object({
    trackId: z.string(),
    listenedSeconds: z.number().int().min(0),
    auth: z.object({
      payer: z.string(),
      payee: z.string(),
      value: z.string(),
      validAfter: z.number(),
      validBefore: z.number(),
      nonce: z.string(),
      signature: z.string(),
    }).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid body' });

  const { trackId, listenedSeconds, auth } = parsed.data;
  const session = (req as any).session;
  const db = getDb();
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) as any;
  if (!track) return res.status(404).json({ error: 'track not found' });

  const artist = db.prepare('SELECT id FROM artists WHERE id = ?').get(track.artist_id) as any;
  const wallet = db.prepare('SELECT address FROM wallets WHERE user_id = ?').get(session.userId) as any;
  if (!wallet) return res.status(400).json({ error: 'no wallet' });

  const wasSkipped = listenedSeconds < track.skip_after_seconds;

  const playId = randomUUID();
  const now = Date.now();
  let chargedUsdc = '0';
  let settlementId: string | null = null;
  let settled = 0;
  let failReason: string | null = null;

  if (!wasSkipped) {
    if (!auth) return res.status(402).json({ error: 'payment required', trackId });
    const verify = await verifyX402Payment(auth);
    if (!verify.ok) {
      failReason = verify.reason ?? 'verify failed';
    } else {
      try {
        const sub = await submitToGateway(auth);
        settlementId = sub.settlementId;
        chargedUsdc = formatUsdc(auth.value);
        settled = 1;
      } catch (e: any) {
        failReason = `submit failed: ${e?.message ?? e}`;
      }
    }
  }

  const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? 0);
  const artistAmount = ((Number(chargedUsdc) * (10_000 - platformFeeBps)) / 10_000).toFixed(6);

  db.prepare(`
    INSERT INTO plays (id, track_id, fan_user_id, fan_wallet_address, listened_seconds,
                       charged_usdc, settled, settlement_id, skipped, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(playId, trackId, session.userId, wallet.address, listenedSeconds, chargedUsdc, settled, settlementId, wasSkipped ? 1 : 0, now);

  if (settled) {
    db.prepare(`UPDATE tracks SET plays_count = plays_count + 1, earnings_usdc = printf('%.6f', earnings_usdc + ?) WHERE id = ?`)
      .run(artistAmount, trackId);
  } else {
    db.prepare(`UPDATE tracks SET plays_count = plays_count + 1 WHERE id = ?`).run(trackId);
  }

  res.json({
    ok: !failReason,
    playId,
    skipped: wasSkipped,
    charged: chargedUsdc,
    settlementId,
    failReason,
    artistReceived: artistAmount,
    explorer: ARC_EXPLORER,
  });
});

// ─── Poll settlement → on-chain batch tx once settled
playRouter.get('/settlement/:id', async (req, res) => {
  try {
    const status = await getSettlementStatus(req.params.id);
    res.json(status);
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? 'failed' });
  }
});

// ─── Recent settled plays (public-ish)
playRouter.get('/recent/:trackId', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, fan_wallet_address, charged_usdc, settled, settlement_id, listened_seconds, created_at
    FROM plays WHERE track_id = ? AND settled = 1 ORDER BY created_at DESC LIMIT 20
  `).all(req.params.trackId);
  res.json({ plays: rows, explorer: ARC_EXPLORER });
});