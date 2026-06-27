/**
 * Account route tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/circle.js', () => ({
  createUser: vi.fn(async (email: string) => ({ userId: email })),
  createUserToken: vi.fn(async (email: string) => ({
    userToken: 'mock-ut-' + email,
    encryptionKey: 'mock-ek',
  })),
  createUserPinWithWallets: vi.fn(async () => ({ challengeId: 'mock-ch' })),
  listWallets: vi.fn(async () => ({
    wallets: [{ id: 'w1', address: '0x' + 'a'.repeat(40), blockchain: 'ARC-TESTNET' }],
  })),
}));

vi.mock('../src/services/arc.js', () => ({
  getUsdcBalance: vi.fn(async () => '5.5'),
  getNativeBalance: vi.fn(async () => '0.1'),
  ARC_CONSTANTS: {
    CHAIN_ID: 5042002,
    USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
    USDC_DECIMALS: 6,
    EXPLORER_URL: 'https://testnet.arcscan.app',
    FAUCET_URL: 'https://faucet.circle.com',
    NETWORK_NAME: 'Arc Testnet',
  },
}));

import { buildApp, clearDb } from './helpers.js';

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  clearDb();
  app = buildApp();
});

async function signupUser(opts: any = {}) {
  const res = await request(app).post('/api/auth/signup').send({
    email: opts.email ?? 'test@example.com',
    password: opts.password ?? 'TestPass123',
    displayName: opts.displayName ?? 'Test User',
    role: opts.role ?? 'fan',
  });
  return res.headers['set-cookie']?.[0];
}

describe('GET /api/account', () => {
  it('returns full profile + wallet + balance for logged-in user', async () => {
    const cookie = await signupUser();
    expect(cookie).toBeTruthy();
    const res = await request(app).get('/api/account').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('test@example.com');
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.wallet).toBeTruthy();
    expect(res.body.wallet.usdcBalance).toBe('5.5');
    expect(res.body.wallet.address).toMatch(/^0x/);
  });

  it('returns 401 without session', async () => {
    const res = await request(app).get('/api/account');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/account', () => {
  it('updates display name, bio, location, social links', async () => {
    const cookie = await signupUser();
    const res = await request(app).patch('/api/account').set('Cookie', cookie).send({
      displayName: 'New Name',
      bio: 'Just a fan.',
      location: 'Lagos, Nigeria',
      socialLinks: { twitter: '@newname', website: 'https://example.com' },
    });
    expect(res.status).toBe(200);
    const get = await request(app).get('/api/account').set('Cookie', cookie);
    expect(get.body.user.display_name).toBe('New Name');
    expect(get.body.user.bio).toBe('Just a fan.');
    expect(get.body.user.location).toBe('Lagos, Nigeria');
    expect(get.body.user.socialLinks.twitter).toBe('@newname');
  });

  it('rejects empty body', async () => {
    const cookie = await signupUser();
    const res = await request(app).patch('/api/account').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/account/avatar', () => {
  it('accepts a small data URL and stores the avatar', async () => {
    const cookie = await signupUser();
    // 1x1 transparent PNG
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const res = await request(app).post('/api/account/avatar').set('Cookie', cookie).send({
      dataUrl: png,
      filename: 'avatar.png',
    });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/avatars\//);
  });

  it('rejects non-image data URLs', async () => {
    const cookie = await signupUser();
    const res = await request(app).post('/api/account/avatar').set('Cookie', cookie).send({
      dataUrl: 'data:text/plain;base64,abc',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/account/change-password', () => {
  it('changes password when current is correct', async () => {
    const cookie = await signupUser();
    const res = await request(app).post('/api/account/change-password').set('Cookie', cookie).send({
      currentPassword: 'TestPass123',
      newPassword: 'NewPass456',
    });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({
      email: 'test@example.com', password: 'NewPass456',
    });
    expect(login.status).toBe(200);
  });

  it('rejects when current password is wrong', async () => {
    const cookie = await signupUser();
    const res = await request(app).post('/api/account/change-password').set('Cookie', cookie).send({
      currentPassword: 'WrongPass',
      newPassword: 'NewPass456',
    });
    expect(res.status).toBe(401);
  });

  it('rejects short new password', async () => {
    const cookie = await signupUser();
    const res = await request(app).post('/api/account/change-password').set('Cookie', cookie).send({
      currentPassword: 'TestPass123',
      newPassword: 'short',
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/account', () => {
  it('deletes the account when password is correct', async () => {
    const cookie = await signupUser();
    const res = await request(app).delete('/api/account').set('Cookie', cookie).send({
      confirmPassword: 'TestPass123',
    });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({
      email: 'test@example.com', password: 'TestPass123',
    });
    expect(login.status).toBe(401);
  });

  it('requires password confirmation', async () => {
    const cookie = await signupUser();
    const res = await request(app).delete('/api/account').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });
});