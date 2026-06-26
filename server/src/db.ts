import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? './pazzera.db';

let db: Database.Database;

export function initDb(): Database.Database {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Application users (email + password). One per real person.
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'fan',     -- 'fan' | 'artist'
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    -- Circle W3S wallets, linked to users. We store the circle user_id
    -- (== email) and the wallet id/address Circle gave us.
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      circle_user_id TEXT NOT NULL,
      circle_wallet_id TEXT NOT NULL,
      address TEXT NOT NULL,
      blockchain TEXT NOT NULL DEFAULT 'ARC-TESTNET',
      account_type TEXT NOT NULL DEFAULT 'SCA',
      pin_setup_complete INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    -- Artist profiles (extends a user with role='artist').
    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bio TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      audio_url TEXT NOT NULL,
      cover_url TEXT,
      duration_seconds INTEGER NOT NULL,
      price_per_listen_usdc TEXT NOT NULL DEFAULT '0.001',
      skip_after_seconds INTEGER NOT NULL DEFAULT 10,
      replay_cooldown_seconds INTEGER NOT NULL DEFAULT 30,
      plays_count INTEGER NOT NULL DEFAULT 0,
      earnings_usdc TEXT NOT NULL DEFAULT '0',
      created_at INTEGER NOT NULL,
      published INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS plays (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      fan_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fan_wallet_address TEXT NOT NULL,
      listened_seconds INTEGER NOT NULL,
      charged_usdc TEXT NOT NULL DEFAULT '0',
      settled INTEGER NOT NULL DEFAULT 0,
      settlement_id TEXT,
      skipped INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plays_track ON plays(track_id);
    CREATE INDEX IF NOT EXISTS idx_plays_fan ON plays(fan_user_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
  `);

  console.log('[pazzera] db ready at', DB_PATH);
  return db;
}

export function getDb(): Database.Database {
  if (!db) initDb();
  return db!;
}