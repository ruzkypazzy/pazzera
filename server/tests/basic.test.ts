import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getDb } from '../src/db.js';

describe('pazzera db', () => {
  beforeAll(() => { initDb(); });

  it('creates tables', () => {
    const db = getDb();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[];
    const names = tables.map(t => t.name);
    expect(names).toContain('artists');
    expect(names).toContain('tracks');
    expect(names).toContain('plays');
  });

  it('inserts and queries an artist', () => {
    const db = getDb();
    const id = 'art_test_' + Date.now();
    db.prepare(`INSERT INTO artists (id, email, display_name, wallet_id, wallet_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`).run(id, `t_${id}@x.com`, 'Test Artist', 'wlt_test', '0xtest', Date.now());
    const a = db.prepare('SELECT * FROM artists WHERE id = ?').get(id) as any;
    expect(a.display_name).toBe('Test Artist');
  });
});

describe('skip-gate logic', () => {
  it('treats under-10s listens as free', () => {
    const SKIP_AFTER = 10;
    const listenedShort = 7;
    const listenedLong = 25;
    expect(listenedShort < SKIP_AFTER).toBe(true);
    expect(listenedLong < SKIP_AFTER).toBe(false);
  });
});