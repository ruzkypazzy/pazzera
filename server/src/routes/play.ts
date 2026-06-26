import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import {
  getOrCreateWallet,
  requestFaucetFunding,
  verifyX402Payment,
  submitToGateway,
  getSettlementStatus,
  usdcUnits,
  formatUsdc,
  NETWORK_ID,
  ARC_EXPLORER,
} from '../services/circle.js';

export const playRouter = Router();

const ARC_USDC = process.env.ARC_USDC_CONTRACT ?? '0x3600000000000000000000000000000000000000';

// ─── Fan signup → embedded Circle wallet ───────────────────
playRouter.post('/signup', async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid email' });
  const { email } = parsed.data;

  const wallet = await getOrCreateWallet(email);
  // Fire-and-forget faucet nudge (real testnet USDC funding requires the
  // developer to call the faucet once or the fan to do it themselves).
  requestFaucetFunding(wallet.address).catch(() => {});

  res.json({ wallet, network: NETWORK_ID, usdcContract: ARC_USDC, explorer: ARC_EXPLORER });
});

// ─── Start play → x402 challenge (HTTP 402) ────────────────
// Returns a typed-data payload the fan's wallet must sign with EIP-712
// TransferWithAuthorization, then POST to /api/play/confirm with the signature.
playRouter.post('/start', async (req, res) => {
  const { trackId, fanEmail } = req.body ?? {};
  if (!trackId || !fanEmail) return res.status(400).json({ error: 'trackId and fanEmail required' });

  const db = getDb();
  const track = db.prepare('SELECT * FROM tracks WHERE id = ? AND published = 1').get(trackId) as any;
  if (!track) return res.status(404).json({ error: 'track not found' });

  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(track.artist_id) as any;
  if (!artist) return res.status(404).json({ error: 'artist not found' });

  const fan = await getOrCreateWallet(fanEmail);

  // Skip gate 1: replay cooldown
  const recent = db.prepare(`
    SELECT created_at FROM plays WHERE track_id = ? AND fan_wallet_address = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(trackId, fan.address) as any;

  const now = Date.now();
  if (recent && now - recent.created_at < track.replay_cooldown_seconds * 1000) {
    return res.json({
      track,
      artist,
      skip: true,
      reason: 'replay_cooldown',
      replayAt: recent.created_at + track.replay_cooldown_seconds * 1000,
    });
  }

  // Build the x402 challenge — EIP-712 TransferWithAuthorization params
  const value = usdcUnits(track.price_per_listen_usdc);
  const nonce = '0x' + randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64);
  const validAfter = Math.floor(now / 1000);
  const validBefore = validAfter + 300; // 5 min

  const challenge = {
    network: NETWORK_ID,
    usdcContract: ARC_USDC,
    payer: fan.address,
    payee: artist.wallet_address,
    value,                 // base units (6 decimals)
    valueUsdc: track.price_per_listen_usdc,
    validAfter,
    validBefore,
    nonce,
    // EIP-712 typed data the frontend feeds to the wallet
    eip712: {
      domain: {
        name: 'USDC',
        version: '2',
        chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
        verifyingContract: ARC_USDC,
      },
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
        from: fan.address,
        to: artist.wallet_address,
        value,
        validAfter,
        validBefore,
        nonce,
      },
    },
  };

  res.json({ track, artist, skip: false, challenge });
});

// ─── Confirm play → verify EIP-712, submit to Gateway ──────
playRouter.post('/confirm', async (req, res) => {
  const parsed = z.object({
    trackId: z.string(),
    fanEmail: z.string().email(),
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
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });

  const { trackId, fanEmail, listenedSeconds, auth } = parsed.data;
  const db = getDb();
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) as any;
  if (!track) return res.status(404).json({ error: 'track not found' });

  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(track.artist_id) as any;
  const fan = await getOrCreateWallet(fanEmail);

  // Skip gate 2: didn't listen long enough → free play
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
    INSERT INTO plays (id, track_id, fan_wallet_address, listened_seconds,
                       charged_usdc, settled, settlement_tx_hash, skipped, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(playId, trackId, fan.address, listenedSeconds, chargedUsdc, settled, settlementId, wasSkipped ? 1 : 0, now);

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
    artistWallet: artist.wallet_address,
    network: NETWORK_ID,
    explorer: ARC_EXPLORER,
  });
});

// ─── Poll settlement → returns on-chain batch tx once settled
playRouter.get('/settlement/:id', async (req, res) => {
  try {
    const status = await getSettlementStatus(req.params.id);
    res.json({
      ...status,
      explorerUrl: status.batchTx ? `${ARC_EXPLORER}/tx/${status.batchTx}` : null,
    });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? 'failed' });
  }
});

// ─── Recent settled plays (public) ──────────────────────────
playRouter.get('/recent/:trackId', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, fan_wallet_address, charged_usdc, settled, settlement_tx_hash, listened_seconds, created_at
    FROM plays WHERE track_id = ? AND settled = 1 ORDER BY created_at DESC LIMIT 20
  `).all(req.params.trackId);
  res.json({ plays: rows, explorer: ARC_EXPLORER });
});