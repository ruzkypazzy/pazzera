/**
 * Seed demo data so judges (and you) have something to click on day 1.
 *
 *   npm run seed
 *
 * Creates demo artists, tracks, and a history of plays (so the dashboard
 * charts and stats endpoints have meaningful numbers).
 *
 * Run against an empty SQLite. Safe to re-run (uses INSERT OR IGNORE).
 */
import { getDb, initDb } from '../src/db.js';
import { randomUUID } from 'node:crypto';

function nowMinus(minutes: number) {
  return Date.now() - minutes * 60_000;
}

async function main() {
  initDb();
  const db = getDb();

  console.log('[seed] creating demo users + artist profiles…');

  const users = [
    {
      id: 'usr_adaeze',
      email: 'adaeze@pazzera.demo',
      password_hash: '$2a$10$demoplaceholderdemoplaceholderdemoplaceholderdemoplace', // demo only
      display_name: 'Adaeze',
      role: 'artist',
    },
    {
      id: 'usr_tunde',
      email: 'tunde@pazzera.demo',
      password_hash: '$2a$10$demoplaceholderdemoplaceholderdemoplaceholderdemoplace',
      display_name: 'Tunde Adebayo',
      role: 'artist',
    },
    {
      id: 'usr_zara',
      email: 'zara@pazzera.demo',
      password_hash: '$2a$10$demoplaceholderdemoplaceholderdemoplaceholderdemoplace',
      display_name: 'Zara Okafor',
      role: 'artist',
    },
    {
      id: 'usr_demo_fan',
      email: 'fan@pazzera.demo',
      password_hash: '$2a$10$demoplaceholderdemoplaceholderdemoplaceholderdemoplace',
      display_name: 'Demo Fan',
      role: 'fan',
    },
  ];

  for (const u of users) {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(u.id, u.email, u.password_hash, u.display_name, u.role, nowMinus(60 * 24 * 30), nowMinus(60 * 2));
  }

  // Demo wallets (synthetic addresses, NOT real Circle wallets — for demo only)
  const wallets = [
    { id: 'wlt_adaeze', user_id: 'usr_adaeze', address: '0xAdA3e5E40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3' },
    { id: 'wlt_tunde', user_id: 'usr_tunde', address: '0x7uNd3E5E40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3' },
    { id: 'wlt_zara', user_id: 'usr_zara', address: '0xZaRa0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3' },
    { id: 'wlt_demo_fan', user_id: 'usr_demo_fan', address: '0xFaN0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3' },
  ];
  for (const w of wallets) {
    db.prepare(`
      INSERT OR IGNORE INTO wallets
      (id, user_id, circle_user_id, circle_wallet_id, address, blockchain, account_type, pin_setup_complete, created_at)
      VALUES (?, ?, ?, ?, ?, 'ARC-TESTNET', 'SCA', 1, ?)
    `).run(w.id, w.user_id, `circle_${w.user_id}`, w.id, w.address, nowMinus(60 * 24 * 28));
  }

  const artists = [
    {
      id: 'art_adaeze',
      user_id: 'usr_adaeze',
      bio: 'Lagos-born vocalist. Afro-fusion rooted in highlife and alté. Two EPs, one mixtape, infinite live shows.',
    },
    {
      id: 'art_tunde',
      user_id: 'usr_tunde',
      bio: 'Producer. Drums first, melody second. Drum patterns are the lead voice; everything else is texture.',
    },
    {
      id: 'art_zara',
      user_id: 'usr_zara',
      bio: 'Songwriter. One-take sessions. Sometimes a voice note is the whole record.',
    },
  ];
  for (const a of artists) {
    db.prepare(`
      INSERT OR IGNORE INTO artists (id, user_id, bio, created_at)
      VALUES (?, ?, ?, ?)
    `).run(a.id, a.user_id, a.bio, nowMinus(60 * 24 * 25));
  }

  console.log('[seed] inserting demo tracks…');

  // Use SoundHelix sample mp3s (royalty-free, real audio URLs)
  const tracks = [
    {
      id: 'trk_adaeze_lagos',
      artist_id: 'art_adaeze',
      title: 'Lagos Nights',
      description: 'A slow-burn highlife cut recorded in one take.',
      audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      duration_seconds: 372,
      price_per_listen_usdc: '0.001',
      skip_after_seconds: 10,
      replay_cooldown_seconds: 30,
    },
    {
      id: 'trk_adaeze_yaba',
      artist_id: 'art_adaeze',
      title: 'Yaba Blues',
      description: 'Yaba left me on read. So I wrote this.',
      audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
      duration_seconds: 295,
      price_per_listen_usdc: '0.0015',
      skip_after_seconds: 10,
      replay_cooldown_seconds: 30,
    },
    {
      id: 'trk_tunde_drum',
      artist_id: 'art_tunde',
      title: 'Drum Pattern #04',
      description: 'Just drums. 4 minutes of gangan.',
      audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
      duration_seconds: 246,
      price_per_listen_usdc: '0.0005',
      skip_after_seconds: 10,
      replay_cooldown_seconds: 30,
    },
    {
      id: 'trk_tunde_atlantic',
      artist_id: 'art_tunde',
      title: 'Atlantic Crossing',
      description: 'Recorded in a single session across two coasts.',
      audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
      duration_seconds: 412,
      price_per_listen_usdc: '0.002',
      skip_after_seconds: 10,
      replay_cooldown_seconds: 30,
    },
    {
      id: 'trk_zara_voicenote',
      artist_id: 'art_zara',
      title: 'Voice Note (Demo)',
      description: 'Sometimes a voice note is the whole record.',
      audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
      duration_seconds: 184,
      price_per_listen_usdc: '0.0005',
      skip_after_seconds: 10,
      replay_cooldown_seconds: 30,
    },
    {
      id: 'trk_zara_untitled',
      artist_id: 'art_zara',
      title: 'Untitled #7',
      description: 'One take. No edits.',
      audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
      duration_seconds: 226,
      price_per_listen_usdc: '0.001',
      skip_after_seconds: 10,
      replay_cooldown_seconds: 30,
    },
  ];
  for (const t of tracks) {
    db.prepare(`
      INSERT OR IGNORE INTO tracks
      (id, artist_id, title, description, audio_url, duration_seconds, price_per_listen_usdc,
       skip_after_seconds, replay_cooldown_seconds, plays_count, earnings_usdc, created_at, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      t.id, t.artist_id, t.title, t.description, t.audio_url, t.duration_seconds, t.price_per_listen_usdc,
      t.skip_after_seconds, t.replay_cooldown_seconds, 0, '0', nowMinus(60 * 24 * (Math.floor(Math.random() * 20) + 1)),
    );
  }

  console.log('[seed] generating realistic play history (last 14 days)…');

  const fanWallets = [
    '0xFaNa0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNb0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNc0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNd0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNe0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNf0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNg0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNh0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNi0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
    '0xFaNj0cA40b1b1Dc80a9cD3fF0bA7D6bEb1a1c2D3',
  ];

  // Track plays over 14 days with varying intensity (growing trend)
  let playId = 1;
  const updateTrackStats = db.prepare(`
    UPDATE tracks SET plays_count = ?, earnings_usdc = ? WHERE id = ?
  `);
  const playCountByTrack: Record<string, { count: number; earn: number }> = {};

  for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
    // Plays per day grow from ~30 to ~200 over the 14-day window
    const basePlays = Math.floor(30 + (14 - daysAgo) * 12);
    const variance = Math.floor(Math.random() * 30);
    const playsToday = basePlays + variance;

    for (let i = 0; i < playsToday; i++) {
      const track = tracks[Math.floor(Math.random() * tracks.length)];
      const fanWallet = fanWallets[Math.floor(Math.random() * fanWallets.length)];
      const listenedSec = Math.floor(track.duration_seconds * (0.4 + Math.random() * 0.6));
      const charged = track.price_per_listen_usdc;
      const settled = Math.random() > 0.05; // 95% settled
      const minuteOfDay = Math.floor(Math.random() * 60 * 24);
      const created = nowMinus(daysAgo * 60 * 24 + minuteOfDay);

      db.prepare(`
        INSERT INTO plays
        (id, track_id, fan_user_id, fan_wallet_address, listened_seconds, charged_usdc, settled, settlement_id, skipped, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        `ply_${(playId++).toString().padStart(6, '0')}`,
        track.id,
        'usr_demo_fan',
        fanWallet,
        listenedSec,
        charged,
        settled ? 1 : 0,
        settled ? `stl_${randomUUID().slice(0, 12)}` : null,
        created,
      );

      playCountByTrack[track.id] = playCountByTrack[track.id] || { count: 0, earn: 0 };
      if (settled) {
        playCountByTrack[track.id].count++;
        playCountByTrack[track.id].earn += Number(charged);
      }
    }
  }

  // Update track-level aggregates
  for (const [trackId, stats] of Object.entries(playCountByTrack)) {
    updateTrackStats.run(stats.count, stats.earn.toFixed(6), trackId);
  }

  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) as users,
      (SELECT COUNT(*) FROM artists) as artists,
      (SELECT COUNT(*) FROM tracks) as tracks,
      (SELECT COUNT(*) FROM plays WHERE settled = 1) as settled_plays,
      (SELECT COUNT(*) FROM plays WHERE skipped = 0) as total_plays,
      (SELECT ROUND(COALESCE(SUM(charged_usdc), 0), 4) FROM plays WHERE settled = 1) as total_usdc
  `).get();

  console.log('[seed] done. Stats:', summary);
  console.log('[seed] Visit https://pazzera.com (or http://localhost:5173 in dev) to see the populated app.');
}

main().catch(e => { console.error(e); process.exit(1); });
