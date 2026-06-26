/**
 * Seed demo data so judges (and you) have something to click on day 1.
 *
 *   npm run seed
 *
 * Creates two demo artists, three tracks, and a few simulated settled plays
 * so the dashboard isn't empty when judges open it. Replace with real tracks
 * before public launch.
 */
import { getDb } from '../src/db.js';
import { createArtistWallet } from '../src/services/circle.js';

async function main() {
  const db = getDb();

  console.log('[seed] creating demo artists…');
  const a1 = await createArtistWallet('ruzkypazzy+pazzera1@pazzera.com');
  const a2 = await createArtistWallet('ruzkypazzy+pazzera2@pazzera.com');

  // Insert if not exists
  const artists = [
    { id: 'art_ruzky',   email: 'ruzkypazzy+pazzera1@pazzera.com', name: 'Ruzky Pazzy',  bio: 'Independent artist. Lepton Hackathon build.', walletId: a1.walletId, address: a1.address },
    { id: 'art_marble',  email: 'ruzkypazzy+pazzera2@pazzera.com', name: 'Marble Lane',  bio: 'Demo artist. Sound, onchain.', walletId: a2.walletId, address: a2.address },
  ];
  for (const a of artists) {
    db.prepare(`INSERT OR IGNORE INTO artists (id, email, display_name, bio, wallet_id, wallet_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(a.id, a.email, a.name, a.bio, a.walletId, a.address, Date.now());
  }

  console.log('[seed] inserting demo tracks…');
  const tracks = [
    { id: 'trk_lepton',  artist_id: 'art_ruzky',  title: 'Lepton (demo)',           audio_url: '/audio/lepton-demo.mp3',  duration: 142, price: '0.001' },
    { id: 'trk_market',  artist_id: 'art_ruzky',  title: 'Open Air Market',         audio_url: '/audio/market-demo.mp3',  duration: 168, price: '0.001' },
    { id: 'trk_arc',     artist_id: 'art_marble', title: 'Arc Light (demo)',        audio_url: '/audio/arc-demo.mp3',     duration: 195, price: '0.0005' },
  ];
  for (const t of tracks) {
    db.prepare(`INSERT OR IGNORE INTO tracks (id, artist_id, title, audio_url, duration_seconds, price_per_listen_usdc, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(t.id, t.artist_id, t.title, t.audio_url, t.duration, t.price, Date.now());
  }

  console.log('[seed] simulating 25 settled plays for traction visibility…');
  const now = Date.now();
  const fanWallets = [
    '0xaaaa000000000000000000000000000000000001',
    '0xbbbb000000000000000000000000000000000002',
    '0xcccc000000000000000000000000000000000003',
    '0xdddd000000000000000000000000000000000004',
  ];
  for (let i = 0; i < 25; i++) {
    const t = tracks[i % tracks.length];
    const fan = fanWallets[i % fanWallets.length];
    db.prepare(`INSERT OR IGNORE INTO plays (id, track_id, fan_wallet_address, listened_seconds, charged_usdc, settled, settlement_tx_hash, skipped, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?)`).run(
      `ply_seed_${i}`, t.id, fan, t.duration, t.price,
      '0x' + Math.random().toString(16).slice(2).padEnd(64, '0'), now - i * 60_000,
    );
    db.prepare(`UPDATE tracks SET plays_count = plays_count + 1, earnings_usdc = printf('%.6f', earnings_usdc + ?) WHERE id = ?`).run(t.price, t.id);
  }

  const stats = db.prepare(`SELECT
    (SELECT COUNT(*) FROM artists) as artists,
    (SELECT COUNT(*) FROM tracks) as tracks,
    (SELECT COUNT(*) FROM plays) as plays,
    (SELECT COUNT(*) FROM plays WHERE settled=1) as settled`).get();
  console.log('[seed] done. Stats:', stats);
}

main().catch(e => { console.error(e); process.exit(1); });