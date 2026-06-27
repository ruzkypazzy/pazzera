/**
 * Postgres adapter for Pazzera.
 *
 * Toggle with DB_DRIVER=postgres (default is sqlite).
 * Required env when in postgres mode: DATABASE_URL.
 *
 * This module is a thin adapter over `pg` that exposes the same
 * better-sqlite3-style API used by db.ts: prepare().run/get/all(),
 * exec() for multi-statement strings, transaction() for tx.
 *
 * Why both? Hackathon runs on SQLite (zero infra). Production runs on
 * Neon Postgres (persistent storage). Same code, two backends.
 */
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('[db-pg] DATABASE_URL is required when DB_DRIVER=postgres');
    }
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech')
        ? { rejectUnauthorized: false }
        : false,
      max: 5,
    });
  }
  return pool;
}

export interface PgStatement {
  run(...params: any[]): { lastInsertRowid?: string; changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

function placeholderize(sql: string): string {
  // SQLite uses ? placeholders. Postgres uses $1, $2, ...
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class PgPrepared implements PgStatement {
  private text: string;
  constructor(sql: string) {
    this.text = placeholderize(sql);
  }
  async _run(params: any[]): Promise<{ rowCount: number }> {
    const r = await getPool().query(this.text, params);
    return { rowCount: r.rowCount ?? 0 };
  }
  run(...params: any[]): { lastInsertRowid?: string; changes: number } {
    // better-sqlite3 sync. pg is async. We can't return a promise from a sync call,
    // so consumers must use the async API. For Pazzera, we only use .all() and .get()
    // (reads) on prepared statements in the hot path; .run() is only used during
    // migration scripts where async is OK. Throw to make this explicit.
    throw new Error('[db-pg] .run() is async on Postgres — use await db.execute(sql, params) instead');
  }
  async _get(params: any[]): Promise<any> {
    const r = await getPool().query(this.text, params);
    return r.rows[0] ?? undefined;
  }
  get(...params: any[]): any {
    throw new Error('[db-pg] .get() is async on Postgres — use await db.fetchOne(sql, params) instead');
  }
  async _all(params: any[]): Promise<any[]> {
    const r = await getPool().query(this.text, params);
    return r.rows;
  }
  all(...params: any[]): any[] {
    throw new Error('[db-pg] .all() is async on Postgres — use await db.fetchAll(sql, params) instead');
  }
}

export const pgDb = {
  /**
   * Execute a single statement, return rows affected.
   */
  async execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
    const r = await getPool().query(placeholderize(sql), params);
    return { rowCount: r.rowCount ?? 0 };
  },
  /**
   * Fetch one row (or undefined).
   */
  async fetchOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const r = await getPool().query(placeholderize(sql), params);
    return (r.rows[0] as T) ?? undefined;
  },
  /**
   * Fetch all rows.
   */
  async fetchAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const r = await getPool().query(placeholderize(sql), params);
    return r.rows as T[];
  },
  /**
   * Run multiple statements in a transaction. If the callback throws, the tx rolls back.
   */
  async transaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
  prepare(sql: string): PgPrepared {
    return new PgPrepared(sql);
  },
  async close() {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};

export const DB_DRIVER = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';
export const IS_POSTGRES = DB_DRIVER === 'postgres';