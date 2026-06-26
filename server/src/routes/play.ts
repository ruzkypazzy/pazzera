import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { verifyX402Auth, settleOnArc, type X402Authorization } from '../services/circle.js';

export const playRouter = Router();

const fanSignupSchema = z.object({
  email: z.string().email(),
});

const playEventSchema = z.object({
  trackId: z.string(),
  fanEmail: z.string().email(),
  listenedSeconds: z.number().int().min(0),
  // For free plays (skip-gated), no auth needed.
  auth: z.any().optional(),
});

// POST /api/play/signup — fan arrives, gets an embedded wallet pre-funded
playRouter.post('/signup', async (req, res) => {
  const parsed = fanSignupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid email' });
  const { getFanWallet, fundWalletFromFaucet } = await import('../services/circle.js');
  const wallet = await getFanWallet(parsed.data.email);
  const funded = await fundWalletFromFaucet(wallet.address);
  res.json({ wallet, fundedUsdc: funded });
});

// POST /api/play/start — fan says "I'm starting this track"
// Returns the x402 challenge (402 Payment Required) with payment details.
// Frontend then signs/authorizes via embedded wallet and posts to /api/play/confirm.
playRouter.post('/start', async (req, res) => {
  const { trackId, fanEmail } = req.body ?? {};
  if (!trackId || !fanEmail) return res.status(400).json({ error: 'trackId and fanEmail required' });

  const db = getDb();
  const track = db.prepare('SELECT * FROM tracks WHERE id = ? AND published = 1').get(trackId) as any;
  if (!track) return res.status(404).json({ error: 'track not found' });

  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(track.artist_id) as any;
  const { getFanWallet } = await import('../services/circle.js');
  const fan = await getFanWallet(fanEmail);

  // Check replay cooldown — same fan, same track, last play within cooldown?
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

  // Issue x402 challenge
  const challenge = {
    payer: fan.address,
    payee: artist.wallet_address,
    amount: track.price_per_listen_usdc,
    resource: trackId,
    validForSeconds: 300,
    nonce: randomUUID(),
  };

  res.json({
    track,
    artist,
    skip: false,
    challenge,
  });
});

// POST /api/play/confirm — fan finished listening, send signed auth, backend settles
playRouter.post('/confirm', async (req, res) => {
  const parsed = playEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid play event' });

  const { trackId, fanEmail, listenedSeconds, auth } = parsed.data;
  const db = getDb();
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) as any;
  if (!track) return res.status(404).json({ error: 'track not found' });

  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(track.artist_id) as any;
  const { getFanWallet } = await import('../services/circle.js');
  const fan = await getFanWallet(fanEmail);

  // Skip-gate: didn't listen long enough → free play, record but don't charge
  const wasSkipped = listenedSeconds < track.skip_after_seconds;

  let chargedUsdc = '0';
  let txHash: string | null = null;
  let settled = 0;

  if (!wasSkipped) {
    if (!auth) return res.status(402).json({ error: 'payment required', track });
    const xAuth: X402Authorization = auth;
    const ok = verifyX402Auth(xAuth);
    if (!ok) return res.status(402).json({ error: 'invalid authorization' });
    chargedUsdc = xAuth.amountUsdc;
    txHash = await settleOnArc(xAuth);
    settled = 1;
  }

  const playId = randomUUID();
  const now = Date.now();
  const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? 0);
  const artistAmount = (Number(chargedUsdc) * (10_000 - platformFeeBps) / 10_000).toString();

  db.prepare(`
    INSERT INTO plays (id, track_id, fan_wallet_address, listened_seconds,
                       charged_usdc, settled, settlement_tx_hash, skipped, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(playId, trackId, fan.address, listenedSeconds, chargedUsdc, settled, txHash, wasSkipped ? 1 : 0, now);

  if (settled) {
    db.prepare(`UPDATE tracks SET plays_count = plays_count + 1, earnings_usdc = printf('%.6f', earnings_usdc + ?) WHERE id = ?`)
      .run(artistAmount, trackId);
  } else {
    db.prepare(`UPDATE tracks SET plays_count = plays_count + 1 WHERE id = ?`).run(trackId);
  }

  res.json({
    ok: true,
    playId,
    skipped: wasSkipped,
    charged: chargedUsdc,
    txHash,
    artistReceived: artistAmount,
    artistWallet: artist.wallet_address,
  });
});

// GET /api/play/recent/:trackId — recent plays (public, for social proof)
playRouter.get('/recent/:trackId', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, fan_wallet_address, charged_usdc, settled, settlement_tx_hash, listened_seconds, created_at
    FROM plays WHERE track_id = ? AND settled = 1 ORDER BY created_at DESC LIMIT 20
  `).all(req.params.trackId);
  res.json({ plays: rows });
});