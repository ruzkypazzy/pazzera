/**
 * Test helpers for Pazzera backend.
 *
 * Pattern: each test gets a fresh in-memory SQLite DB by clearing all tables
 * in beforeEach. The db module singleton stays the same (so routes can use it),
 * but the data inside is wiped.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import type Database from 'better-sqlite3';
import { initDb } from '../src/db.js';
import { authRouter } from '../src/routes/auth.js';
import { passwordResetRouter } from '../src/routes/password-reset.js';
import { accountRouter } from '../src/routes/account.js';
import { resetRateLimits } from '../src/services/rate-limit.js';

export type TestApp = express.Express;

/**
 * Build an Express app with all routes mounted.
 */
export function buildApp(): TestApp {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-32-bytes-padding';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-enc-key-32-bytes-padding';
  initDb();

  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/auth', passwordResetRouter);
  app.use('/api/account', accountRouter);
  return app;
}

/**
 * Wipe all data from the in-memory DB + reset rate limits. Use in beforeEach.
 */
export function clearDb() {
  const db = initDb() as Database.Database;
  const tables = [
    'audit_log', 'rate_limits', 'follows', 'uploads',
    'plays', 'tracks', 'artists', 'wallets',
    'password_resets', 'sessions', 'users',
  ];
  for (const t of tables) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch {}
  }
  resetRateLimits();
}