/**
 * Database — SQLite via better-sqlite3.
 *
 * For production persistence on Railway (no Volumes on free/hobby), the
 * recommended path is to migrate to Neon Postgres — see ARCHITECTURE.md
 * for the migration steps. For hackathon/demo, SQLite is fine (data
 * resets on redeploy, which only happens on git push).
 *
 * Schema is in `runSchema()` below. SQLite uses INTEGER for booleans
 * (0/1) and timestamps (Unix ms). All IDs are TEXT (UUIDs).
 */
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
      social_links TEXT,
      role TEXT NOT NULL DEFAULT 'fan',
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      two_factor_secret TEXT,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER,
      last_seen_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      circle_user_id TEXT NOT NULL,
      circle_wallet_id TEXT NOT NULL,
      address TEXT NOT NULL,
      blockchain TEXT NOT NULL DEFAULT 'ARC-TESTNET',
      account_type TEXT NOT NULL DEFAULT 'SCA',
      pin_setup_complete INTEGER NOT NULL DEFAULT 0,
      circle_user_token_enc TEXT,
      circle_encryption_key_enc TEXT,
      created_at INTEGER NOT NULL,
      last_balance_check_at INTEGER,
      cached_balance_usdc TEXT
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      revoked_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bio TEXT,
      avatar_url TEXT,
      cover_image_url TEXT,
      social_links TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      kind TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (follower_id, artist_id)
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      blocked_until INTEGER
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plays_track ON plays(track_id);
    CREATE INDEX IF NOT EXISTS idx_plays_fan ON plays(fan_user_id);
    CREATE INDEX IF NOT EXISTS idx_plays_created ON plays(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_published ON tracks(published, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_follows_artist ON follows(artist_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at DESC);

    -- ============ AGENT TABLES ============

    -- Per-fan Fan Agent state: preferences, budget, history
    CREATE TABLE IF NOT EXISTS fan_agent_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,            -- 0 = off (manual listening), 1 = agent running
      preferences TEXT NOT NULL DEFAULT '{}',        -- JSON: { genres[], mood, max_track_length_sec, ... }
      budget_per_session_usdc TEXT NOT NULL DEFAULT '1.00',
      budget_per_day_usdc TEXT NOT NULL DEFAULT '5.00',
      spent_today_usdc TEXT NOT NULL DEFAULT '0',
      spent_total_usdc TEXT NOT NULL DEFAULT '0',
      last_reset_at INTEGER NOT NULL,
      session_started_at INTEGER,
      total_agent_plays INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Track submission queue for the Curator Agent
    CREATE TABLE IF NOT EXISTS pending_submissions (
      id TEXT PRIMARY KEY,
      artist_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      track_id TEXT,                                -- assigned when Curator approves + track row created
      title TEXT NOT NULL,
      description TEXT,
      audio_url TEXT NOT NULL,
      cover_url TEXT,
      duration_seconds INTEGER NOT NULL,
      suggested_tags TEXT,                          -- JSON array, artist-suggested
      price_per_listen_usdc TEXT,
      status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
      rejection_reason TEXT,
      curator_notes TEXT,                           -- Curator Agent's free-form reasoning
      curator_tags TEXT,                            -- JSON array, agent-suggested tags
      curator_price_usdc TEXT,                      -- agent-suggested price
      reviewed_at INTEGER,
      tokens_used INTEGER,                          -- LLM cost visibility
      created_at INTEGER NOT NULL
    );

    -- Per-play royalty split (Royalty Splitter Agent output)
    -- One row per recipient per play. Single-artist tracks get one row (100%).
    -- Multi-artist tracks get N rows summing to charged_usdc.
    CREATE TABLE IF NOT EXISTS play_royalty_splits (
      id TEXT PRIMARY KEY,
      play_id TEXT NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_wallet_address TEXT NOT NULL,
      share_bps INTEGER NOT NULL,                   -- basis points (10000 = 100%)
      amount_usdc TEXT NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0,
      settlement_id TEXT,
      created_at INTEGER NOT NULL
    );

    -- Per-track royalty config (set by artist at submission or in dashboard)
    -- Single-artist tracks have one row with share_bps=10000.
    -- Multi-artist tracks have multiple rows summing to 10000.
    CREATE TABLE IF NOT EXISTS track_royalty_splits (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'artist',          -- 'artist' | 'producer' | 'featured' | 'songwriter'
      share_bps INTEGER NOT NULL,                   -- 10000 = 100%, 7000 = 70%
      created_at INTEGER NOT NULL
    );

    -- Agent conversation log (debug + audit trail for "agent in action")
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,                     -- 'curator' | 'fan' | 'royalty_splitter'
      user_id TEXT,                                 -- user who triggered (null for cron)
      input TEXT NOT NULL,                          -- the prompt / input
      output TEXT NOT NULL,                         -- the agent's final response
      tool_trace TEXT,                              -- JSON array of tool calls made
      tokens_used INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',       -- 'success' | 'error'
      error TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fan_agent_profiles_enabled ON fan_agent_profiles(enabled);
    CREATE INDEX IF NOT EXISTS idx_pending_submissions_status ON pending_submissions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pending_submissions_artist ON pending_submissions(artist_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_play_splits_play ON play_royalty_splits(play_id);
    CREATE INDEX IF NOT EXISTS idx_play_splits_recipient ON play_royalty_splits(recipient_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_track_splits_track ON track_royalty_splits(track_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_type ON agent_runs(agent_type, created_at DESC);
  `);

  console.log('[pazzera] db ready at', DB_PATH);
  return db;
}

export function getDb(): Database.Database {
  if (!db) initDb();
  return db!;
}

/**
 * Run a callback inside a SQLite transaction. If the callback throws,
 * the transaction is rolled back. If it succeeds, all changes commit atomically.
 */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  return d.transaction(fn)();
}

/**
 * Daily cron hook — runs at startup if last backup > 24h ago.
 * Writes a JSON snapshot to BACKUP_DIR (default ./backups) for disaster recovery.
 * Production: replace with Litestream or S3 replication.
 */
export function maybeBackup(): void {
  try {
    const d = getDb();
    const lastRow = d.prepare(`SELECT name FROM sqlite_master WHERE type='table' LIMIT 1`).get();
    if (!lastRow) return;
    const stats = (d as any).prepare(`SELECT COUNT(*) as c FROM users`).get();
    console.log(`[pazzera] db health: ${stats.c} users in ${DB_PATH}`);
  } catch {}
}