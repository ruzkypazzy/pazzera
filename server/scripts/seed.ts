/**
 * Seed demo data so judges (and you) have something to click on day 1.
 *
 *   npm run seed
 *
 * Creates two demo artists + three tracks using real Circle W3S wallets on
 * Arc Testnet. No fake plays — the dashboard starts empty so the first real
 * plays that come in via the demo flow are visible without noise.
 */
import { getDb } from '../src/db.js';
import { getOrCreateWallet } from '../src/services/circle.js';
import { randomUUID } from 'node:crypto';

async function main() {
  const db = getDb();

  console.log('[seed] creating demo artist wallets via Circle W3S…');
  const a1 = await getOrCreateWallet('ruzkypazzy+pazzera1@pazzera.com');
  const a2 = await getOrCreateWallet('ruzkypazzy+pazzera2@pazzera.com');

  const artists = [
    { id: 'art_ruzky',   email: 'ruzkypazzy+pazzera1@pazzera.com', name: 'Ruzky Pazzy',  bio: 'Independent artist. Lepton Hackathon build.', walletId: a1.walletId, address: a1.address },
    { id: 'art_marble',  email: 'ruzkypazzy+pazzera2@pazzera.com', name: 'Marble Lane',  bio: 'Demo artist. Sound, onchain.',             walletId: a2.walletId, address: a2.address },
  ];
  for (const a of artists) {
    db.prepare(`INSERT OR IGNORE INTO artists (id, email, display_name, bio, wallet_id, wallet_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(a.id, a.email, a.name, a.bio, a.walletId, a.address, Date.now());
  }

  console.log('[seed] inserting demo tracks (audio_url must be set by artist)…');
  const tracks = [
    { id: 'trk_lepton',  artist_id: 'art_ruzky',  title: 'Lepton (demo)',    audio_url: '', duration: 142, price: '0.001'  },
    { id: 'trk_market',  artist_id: 'art_ruzky',  title: 'Open Air Market',  audio_url: '', duration: 168, price: '0.001'  },
    { id: 'trk_arc',     artist_id: 'art_marble', title: 'Arc Light (demo)', audio_url: '', duration: 195, price: '0.0005' },
  ];
  for (const t of tracks) {
    db.prepare(`INSERT OR IGNORE INTO tracks (id, artist_id, title, audio_url, duration_seconds, price_per_listen_usdc, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(t.id, t.artist_id, t.title, t.audio_url, t.duration, t.price, Date.now());
  }

  console.log('[seed] inserting a placeholder row so the dashboard isn\'t empty…');
  // Single empty placeholder play — no fake settlement, no fake tx hash.
  // This row exists only so the "Recent plays" table renders. The real
  // judge-visible plays will be the ones that come in through the demo flow.
  db.prepare(`INSERT OR IGNORE INTO plays (id, track_id, fan_wallet_address, listened_seconds, charged_usdc, settled, settlement_tx_hash, skipped, created_at)
              VALUES (?, ?, ?, ?, ?, 0, NULL, 0, ?)`).run(
    'ply_placeholder_' + randomUUID().slice(0, 8),
    'trk_lepton',
    '0x0000000000000000000000000000000000000000',
    0, '0', Date.now() - 60_000,
  );

  const stats = db.prepare(`SELECT
    (SELECT COUNT(*) FROM artists) as artists,
    (SELECT COUNT(*) FROM tracks) as tracks,
    (SELECT COUNT(*) FROM plays) as plays`).get();
  console.log('[seed] done. Stats:', stats);
  console.log('[seed] NOTE: artist wallets are real Arc Testnet addresses.');
  console.log('[seed]       Fund them at https://faucet.circle.com before live demo.');
}

main().catch(e => { console.error(e); process.exit(1); });