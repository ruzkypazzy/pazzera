/**
 * Password reset route tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

vi.mock('../src/services/circle.js', () => ({
  createUser: vi.fn(async (email: string) => ({ userId: email })),
  createUserToken: vi.fn(async (email: string) => ({
    userToken: 'mock',
    encryptionKey: 'mock',
  })),
  createUserPinWithWallets: vi.fn(async () => ({ challengeId: 'mock' })),
  listWallets: vi.fn(async () => ({
    wallets: [{ id: 'w1', address: '0x' + 'b'.repeat(40), blockchain: 'ARC-TESTNET' }],
  })),
}));

import { buildApp, clearDb } from './helpers.js';
import { generateToken } from '../src/services/email.js';
import { hashToken } from '../src/services/crypto.js';
import { getDb } from '../src/db.js';

let app: ReturnType<typeof buildApp>;
let validToken: string;
let validUid: string;

beforeEach(async () => {
  clearDb();
  app = buildApp();

  // Create a user and a valid reset token manually (so we know the plaintext)
  const signup = await request(app).post('/api/auth/signup').send({
    email: 'reset@example.com',
    password: 'OldPass123',
    displayName: 'Reset Test',
  });
  expect(signup.status).toBe(200);
  const userRow = getDb().prepare(`SELECT id FROM users LIMIT 1`).get() as any;
  if (!userRow) throw new Error('user not created in beforeEach');
  validUid = userRow.id;
  validToken = generateToken(32);
  getDb().prepare(`
    INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), validUid, hashToken(validToken), Date.now() + 60 * 60 * 1000, Date.now());
});

describe('POST /api/auth/forgot-password', () => {
  it('returns 200 even if email not found (no user enumeration)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'unknown@example.com' });
    expect(res.status).toBe(200);
  });

  it('generates a reset token when email exists', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'reset@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.previewUrl).toBeTruthy();
  });

  it('requires email field', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('resets password with valid token', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({
      token: validToken, uid: validUid, newPassword: 'NewPass456',
    });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({
      email: 'reset@example.com', password: 'NewPass456',
    });
    expect(login.status).toBe(200);
  });

  it('rejects expired token', async () => {
    getDb().prepare(`UPDATE password_resets SET expires_at = ? WHERE user_id = ?`).run(Date.now() - 1000, validUid);
    const res = await request(app).post('/api/auth/reset-password').send({
      token: validToken, uid: validUid, newPassword: 'NewPass456',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('rejects already-used token', async () => {
    await request(app).post('/api/auth/reset-password').send({ token: validToken, uid: validUid, newPassword: 'NewPass456' });
    const second = await request(app).post('/api/auth/reset-password').send({
      token: validToken, uid: validUid, newPassword: 'AnotherPass789',
    });
    expect(second.status).toBe(400);
  });

  it('rejects short new password', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({
      token: validToken, uid: validUid, newPassword: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid token', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({
      token: 'wrong-token-here-padded-to-look-real', uid: validUid, newPassword: 'NewPass456',
    });
    expect(res.status).toBe(400);
  });
});