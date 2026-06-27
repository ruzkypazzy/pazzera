/**
 * Auth route tests — signup, login, logout, account lockout.
 * Uses an isolated in-memory SQLite DB cleared in beforeEach.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Mock Circle SDK before importing routes
// IMPORTANT: each mock must match the return shape of the real function.
vi.mock('../src/services/circle.js', () => ({
  createUser: vi.fn(async (email: string) => ({ userId: email })),
  createUserToken: vi.fn(async (email: string) => ({
    userToken: 'mock-user-token-' + email,
    encryptionKey: 'mock-enc-key',
  })),
  createUserPinWithWallets: vi.fn(async () => ({ challengeId: 'mock-challenge-id' })),
  listWallets: vi.fn(async () => ({
    wallets: [{ id: 'w1', address: '0x' + 'a'.repeat(40), blockchain: 'ARC-TESTNET' }],
  })),
}));

import { buildApp, clearDb } from './helpers.js';

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  clearDb();
  app = buildApp();
});

describe('POST /api/auth/signup', () => {
  it('creates a new user and issues a session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'test@example.com', password: 'TestPass123', displayName: 'Test User', role: 'fan' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('test@example.com');
    expect(res.body.user.display_name).toBe('Test User');
    expect(res.body.user.role).toBe('fan');
    expect(res.body.wallet).toBeTruthy();
    expect(res.body.wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(res.body.challengeId).toBe('mock-challenge-id');
    expect(res.headers['set-cookie']).toBeTruthy();
  });

  it('rejects duplicate email', async () => {
    await request(app).post('/api/auth/signup').send({
      email: 'dupe@example.com', password: 'TestPass123', displayName: 'First',
    });
    const res = await request(app).post('/api/auth/signup').send({
      email: 'dupe@example.com', password: 'TestPass123', displayName: 'Second',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it('rejects weak password', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'weak@example.com', password: 'short', displayName: 'Test',
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid email', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'not-an-email', password: 'TestPass123', displayName: 'Test',
    });
    expect(res.status).toBe(400);
  });

  it('creates artist profile when role=artist', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'artist@example.com', password: 'TestPass123', displayName: 'The Artist', role: 'artist', bio: 'I make beats',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('artist');
  });
});

describe('POST /api/auth/login', () => {
  async function setupUser(email = 'login@example.com') {
    await request(app).post('/api/auth/signup').send({
      email, password: 'TestPass123', displayName: 'Login Test',
    });
  }

  it('returns user on valid credentials', async () => {
    await setupUser();
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'TestPass123' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('login@example.com');
  });

  it('rejects wrong password', async () => {
    await setupUser();
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'WrongPassword' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown email (no user enumeration)', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'TestPass123' });
    expect(res.status).toBe(401);
  });

  it('locks account after 5 failed logins', async () => {
    await setupUser();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login')
        .send({ email: 'login@example.com', password: 'WrongPassword' });
    }
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'TestPass123' });
    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/locked/i);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user when session cookie present', async () => {
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'me@example.com', password: 'TestPass123', displayName: 'Me',
    });
    const cookies = signup.headers['set-cookie'];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies) as string;
    expect(cookie).toBeTruthy();
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('me@example.com');
  });

  it('returns 401 without session', async () => {
    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'logout@example.com', password: 'TestPass123', displayName: 'Logout',
    });
    const cookies = signup.headers['set-cookie'];
    const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
    expect(cookie).toBeTruthy();
    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie as string);
    expect(logout.status).toBe(200);
    const logoutCookies = logout.headers['set-cookie'];
    const cookieHeader = Array.isArray(logoutCookies) ? logoutCookies[0] : logoutCookies;
    expect(cookieHeader).toMatch(/pazzera_session=;|Expires=Thu, 01 Jan 1970/);
  });
});