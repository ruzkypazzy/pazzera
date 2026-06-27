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
  db.pragma('busy_timeout = 5000');

  db.exec(`
    -- =====================================================================
    -- USERS — one row per real person (fan or artist)
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verification_token TEXT,
      email_verification_expires_at INTEGER,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bio TEXT,
      avatar_url TEXT,
      location TEXT,
      social_links TEXT,                              -- JSON: {twitter, instagram, website}
      role TEXT NOT NULL DEFAULT 'fan',               -- 'fan' | 'artist'
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      two_factor_secret TEXT,                         -- TOTP secret (encrypted at rest)
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,                           -- null = not locked, else ms epoch
      created_at INTEGER NOT NULL,
      last_login_at INTEGER,
      last_seen_at INTEGER
    );

    -- =====================================================================
    -- WALLETS — Circle W3S wallets (1 per user, future-proof for multi-chain)
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      circle_user_id TEXT NOT NULL,
      circle_wallet_id TEXT NOT NULL,
      address TEXT NOT NULL,
      blockchain TEXT NOT NULL DEFAULT 'ARC-TESTNET',
      account_type TEXT NOT NULL DEFAULT 'SCA',
      pin_setup_complete INTEGER NOT NULL DEFAULT 0,
      circle_user_token_enc TEXT,                    -- AES-encrypted userToken (refresh on demand)
      circle_encryption_key_enc TEXT,                -- AES-encrypted encryptionKey (for SDK)
      created_at INTEGER NOT NULL,
      last_balance_check_at INTEGER,
      cached_balance_usdc TEXT                        -- last known USDC balance (cache for perf)
    );

    -- =====================================================================
    -- PASSWORD RESET — single-use tokens
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );

    -- =====================================================================
    -- SESSIONS — server-side session log (audit trail, not auth source)
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      revoked_at INTEGER
    );

    -- =====================================================================
    -- ARTISTS — extension of users with role='artist'
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bio TEXT,
      avatar_url TEXT,
      cover_image_url TEXT,
      social_links TEXT,                              -- JSON
      verified INTEGER NOT NULL DEFAULT 0,           -- platform-verified artist flag
      created_at INTEGER NOT NULL
    );

    -- =====================================================================
    -- TRACKS — published music
    -- =====================================================================
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

    -- =====================================================================
    -- PLAYS — listen events with payment state
    -- =====================================================================
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

    -- =====================================================================
    -- UPLOADS — track audio/cover files (user-uploaded)
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      kind TEXT NOT NULL,                             -- 'audio' | 'cover' | 'avatar'
      storage_path TEXT NOT NULL,                     -- local path on Railway Volume
      sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- =====================================================================
    -- FOLLOWERS — fan follows artist (for "subscribed artists" in feed)
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (follower_id, artist_id)
    );

    -- =====================================================================
    -- RATE LIMITS — track failed attempts per IP/email
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      blocked_until INTEGER
    );

    -- =====================================================================
    -- AUDIT LOG — security-sensitive actions
    -- =====================================================================
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      metadata TEXT,                                  -- JSON
      created_at INTEGER NOT NULL
    );

    -- =====================================================================
    -- INDEXES
    -- =====================================================================
    CREATE INDEX IF NOT EXISTS idx_plays_track ON plays(track_id);
    CREATE INDEX IF NOT EXISTS idx_plays_fan ON plays(fan_user_id);
    CREATE INDEX IF NOT EXISTS idx_plays_created ON plays(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_published ON tracks(published, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(user_id, revoked_at, last_active_at DESC);
    CREATE INDEX IF NOT EXISTS idx_follows_artist ON follows(artist_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at DESC);
  `);

  console.log('[pazzera] db ready at', DB_PATH);
  return db;
}

export function getDb(): Database.Database {
  if (!db) initDb();
  return db!;
}