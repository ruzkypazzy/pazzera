/**
 * Circle Developer-Controlled Wallets (DCW) — Pazzera backend service.
 *
 * All operations happen server-side. No browser SDK. No PIN. No client key.
 *
 * Required env:
 *   CIRCLE_API_KEY        - Circle API key
 *   CIRCLE_APP_ID         - Circle app ID
 *   CIRCLE_ENTITY_SECRET  - 32-byte hex entity secret
 *   CIRCLE_WALLET_SET_ID  - Wallet set ID created from that entity secret
 *
 * DCW OTP flow (email-based auth):
 *   1. POST /v1/w3s/users                          - create user by userId (email)
 *   2. POST /v1/w3s/users/email/otp                - send OTP to user's email via Circle
 *   3. POST /v1/w3s/users/email/otp/verify         - verify OTP → returns userId confirmed
 *   4. POST /v1/w3s/developer/wallets              - create DCW wallet for user
 *   5. GET  /v1/w3s/developer/wallets/{id}         - read wallet address
 */

import { randomUUID } from 'node:crypto';
import * as nodeCrypto from 'node:crypto';

const BASE = 'https://api.circle.com';
const API_KEY = () => process.env.CIRCLE_API_KEY ?? '';
const APP_ID = () => process.env.CIRCLE_APP_ID ?? '';
const ENTITY_SECRET = () => process.env.CIRCLE_ENTITY_SECRET ?? '';
const WALLET_SET_ID = () => process.env.CIRCLE_WALLET_SET_ID ?? '';

interface CircleResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  errorCode?: number;
}

async function circleFetch<T = any>(
  path: string,
  opts: {
    method?: string;
    body?: any;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<CircleResponse<T>> {
  const apiKey = API_KEY();
  if (!apiKey) return { ok: false, status: 503, error: 'CIRCLE_API_KEY not set' };

  const url = `${BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(opts.headers ?? {}),
  };

  const timeoutMs = opts.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: json?.message ?? json?.errors?.[0]?.message ?? text.slice(0, 500),
        errorCode: json?.code,
      };
    }
    return { ok: true, status: r.status, data: json?.data ?? json };
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      return { ok: false, status: 504, error: `Circle API timed out after ${timeoutMs}ms` };
    }
    return { ok: false, status: 500, error: e?.message ?? String(e) };
  }
}

// ── Entity secret ciphertext generation ────────────────────
// Must use RSA-OAEP with SHA-256, not PKCS1. Required per Circle DCW spec.
async function generateEntitySecretCiphertext(publicKeyPem: string): Promise<string> {
  const secret = ENTITY_SECRET();
  if (!secret) throw new Error('CIRCLE_ENTITY_SECRET not set');
  if (secret.length !== 64) throw new Error('CIRCLE_ENTITY_SECRET must be 64 hex chars (32 bytes)');

  const secretBytes = Buffer.from(secret, 'hex');
  const ciphertext = nodeCrypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    secretBytes,
  );
  return ciphertext.toString('base64');
}

// ── Setup helpers ───────────────────────────────────────────

export async function getEntityPublicKey(): Promise<CircleResponse<{ publicKey: string }>> {
  return circleFetch('/v1/w3s/config/entity/publicKey');
}

export async function registerEntitySecret(
  entitySecret: string,
  entitySecretCiphertext?: string,
): Promise<CircleResponse> {
  if (!entitySecretCiphertext) {
    const pk = await getEntityPublicKey();
    if (!pk.ok || !pk.data?.publicKey) {
      return { ok: false, status: pk.status, error: 'failed to fetch public key: ' + (pk.error ?? 'unknown') };
    }
    try {
      const secretBytes = Buffer.from(entitySecret, 'hex');
      const ciphertext = nodeCrypto.publicEncrypt(
        {
          key: pk.data.publicKey,
          padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        secretBytes,
      );
      entitySecretCiphertext = ciphertext.toString('base64');
    } catch (e: any) {
      return { ok: false, status: 500, error: 'failed to encrypt entity secret: ' + (e?.message ?? e) };
    }
  }
  return circleFetch('/v1/w3s/config/entity/secret', {
    method: 'PUT',
    body: { entitySecretCiphertext },
  });
}

export async function createWalletSet(name: string): Promise<CircleResponse<{ walletSet: { id: string } }>> {
  if (!ENTITY_SECRET()) {
    return { ok: false, status: 503, error: 'CIRCLE_ENTITY_SECRET not set' };
  }

  // Must generate fresh RSA-OAEP ciphertext for every request
  const pk = await getEntityPublicKey();
  if (!pk.ok || !pk.data?.publicKey) {
    return { ok: false, status: pk.status, error: 'failed to fetch entity public key: ' + (pk.error ?? '') };
  }

  let ciphertext: string;
  try {
    ciphertext = await generateEntitySecretCiphertext(pk.data.publicKey);
  } catch (e: any) {
    return { ok: false, status: 500, error: 'entity secret encryption failed: ' + (e?.message ?? e) };
  }

  return circleFetch('/v1/w3s/developer/walletSets', {
    method: 'POST',
    body: {
      idempotencyKey: randomUUID(),
      name,
      entitySecretCiphertext: ciphertext,
    },
  });
}

// ── User management ─────────────────────────────────────────

export async function ensureUser(email: string): Promise<{ ok: boolean; userId: string; error?: string }> {
  const r = await circleFetch('/v1/w3s/users', {
    method: 'POST',
    body: { userId: email },
  });
  // 409 = already exists — that's fine
  if (r.ok) return { ok: true, userId: email };
  if (r.status === 409) return { ok: true, userId: email };
  return { ok: false, userId: email, error: r.error };
}

// ── Email OTP (DCW flow) ────────────────────────────────────
// Circle DCW email OTP uses /v1/w3s/users/email/otp (NOT /users/email/token)

export async function sendEmailOtp(email: string): Promise<CircleResponse> {
  // DCW endpoint: send OTP to user's email
  const r = await circleFetch('/v1/w3s/users/email/otp', {
    method: 'POST',
    body: { userId: email },
  });
  // Fallback: some Circle API versions use /users/email/token
  if (!r.ok && (r.status === 404 || r.status === 400)) {
    const r2 = await circleFetch('/v1/w3s/users/email/token', {
      method: 'POST',
      body: { userId: email },
    });
    return r2;
  }
  return r;
}

export async function verifyEmailOtp(
  email: string,
  otp: string,
): Promise<CircleResponse<{ accessToken?: string }>> {
  // DCW endpoint: verify OTP
  const r = await circleFetch<{ accessToken?: string }>('/v1/w3s/users/email/otp/verify', {
    method: 'POST',
    body: { userId: email, otp },
  });
  // Fallback for older API versions
  if (!r.ok && (r.status === 404 || r.status === 400)) {
    return circleFetch<{ accessToken?: string }>('/v1/w3s/users/email/authenticate', {
      method: 'PUT',
      body: { userId: email, otp },
    });
  }
  return r;
}

// ── Wallet management ───────────────────────────────────────

export async function createUserWallet(
  email: string,
): Promise<CircleResponse<{ wallet: { id: string; address: string; blockchain: string; state: string } }>> {
  const walletSetId = WALLET_SET_ID();
  if (!walletSetId) {
    return {
      ok: false,
      status: 503,
      error:
        'CIRCLE_WALLET_SET_ID not set on Railway. Set it to: 622c08e4-6295-5ed2-a0ad-ababff77a02f',
    };
  }
  if (!ENTITY_SECRET()) {
    return { ok: false, status: 503, error: 'CIRCLE_ENTITY_SECRET not set on Railway' };
  }

  // Generate fresh ciphertext for this request (required — no replay allowed)
  const pk = await getEntityPublicKey();
  if (!pk.ok || !pk.data?.publicKey) {
    return { ok: false, status: pk.status, error: 'failed to fetch entity public key' };
  }

  let ciphertext: string;
  try {
    ciphertext = await generateEntitySecretCiphertext(pk.data.publicKey);
  } catch (e: any) {
    return { ok: false, status: 500, error: 'entity secret encryption failed: ' + (e?.message ?? e) };
  }

  return circleFetch('/v1/w3s/developer/wallets', {
    method: 'POST',
    body: {
      idempotencyKey: randomUUID(),
      walletSetId,
      accountType: 'EOA',
      blockchains: ['ARC-TESTNET'],
      count: 1,
      entitySecretCiphertext: ciphertext,
      metadata: [{ name: 'userId', value: email }],
    },
  });
}

export async function getWallet(
  walletId: string,
): Promise<CircleResponse<{ wallet: { id: string; address: string; blockchain: string; state: string; balances: any[] } }>> {
  return circleFetch(`/v1/w3s/developer/wallets/${walletId}`);
}

export async function listUserWallets(email: string): Promise<CircleResponse<{ wallets: any[] }>> {
  // List wallets filtered by metadata userId
  return circleFetch(
    `/v1/w3s/developer/wallets?walletSetId=${encodeURIComponent(WALLET_SET_ID())}&metadata=${encodeURIComponent(JSON.stringify([{ name: 'userId', value: email }]))}`,
  );
}

// ── EIP-712 signing ─────────────────────────────────────────

export async function signTypedData(args: {
  walletId: string;
  data: string;
}): Promise<CircleResponse<{ signature: string }>> {
  if (!ENTITY_SECRET()) {
    return { ok: false, status: 503, error: 'CIRCLE_ENTITY_SECRET not set' };
  }

  const pk = await getEntityPublicKey();
  if (!pk.ok || !pk.data?.publicKey) {
    return { ok: false, status: pk.status, error: 'failed to fetch entity public key' };
  }

  let ciphertext: string;
  try {
    ciphertext = await generateEntitySecretCiphertext(pk.data.publicKey);
  } catch (e: any) {
    return { ok: false, status: 500, error: 'entity secret encryption failed: ' + (e?.message ?? e) };
  }

  return circleFetch<{ signature: string }>('/v1/w3s/developer/sign/typedData', {
    method: 'POST',
    body: { ...args, entitySecretCiphertext: ciphertext },
  });
}

// ── End-to-end: provision user + wallet ─────────────────────

export async function provisionUserWallet(email: string): Promise<{
  ok: boolean;
  address?: string;
  walletId?: string;
  error?: string;
  steps: string[];
}> {
  const steps: string[] = [];

  const u = await ensureUser(email);
  if (!u.ok) {
    steps.push(`ensureUser failed: ${u.error}`);
    return { ok: false, error: u.error, steps };
  }
  steps.push('user ready');

  // Check if wallet already exists for this user
  const existing = await listUserWallets(email);
  const existingWallets = existing.data?.wallets ?? [];
  if (existing.ok && existingWallets.length > 0) {
    const w = existingWallets[0];
    steps.push(`found existing wallet ${w.id}`);
    if (w.address) {
      return { ok: true, address: w.address, walletId: w.id, steps };
    }
    const detail = await getWallet(w.id);
    if (detail.ok && detail.data?.wallet?.address) {
      return { ok: true, address: detail.data.wallet.address, walletId: w.id, steps };
    }
  }

  // Create new wallet
  const w = await createUserWallet(email);
  if (!w.ok) {
    steps.push(`createUserWallet failed: ${w.error}`);
    return { ok: false, error: w.error, steps };
  }

  // Handle both response shapes: { wallet } and { wallets: [...] }
  const walletObj = (w.data as any)?.wallet ?? (w.data as any)?.wallets?.[0];
  const walletId = walletObj?.id;
  steps.push(`wallet ${walletId} created`);

  if (walletObj?.address) {
    steps.push(`address: ${walletObj.address}`);
    return { ok: true, address: walletObj.address, walletId: walletId!, steps };
  }

  if (!walletId) {
    return { ok: false, error: 'wallet id missing after createUserWallet', steps };
  }

  const detail = await getWallet(walletId);
  if (!detail.ok || !detail.data?.wallet?.address) {
    steps.push(`getWallet failed: ${detail.error}`);
    return { ok: false, error: 'wallet created but could not read address', steps };
  }
  steps.push(`address: ${detail.data.wallet.address}`);
  return { ok: true, address: detail.data.wallet.address, walletId, steps };
}
