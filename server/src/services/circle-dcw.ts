/**
 * Circle Developer-Controlled Wallets (DCW) — Polaris Swarm's exact pattern.
 *
 * All operations happen server-side. No browser SDK. No PIN. No client key.
 *
 * Required env:
 *   CIRCLE_API_KEY        - Circle API key (already set)
 *   CIRCLE_APP_ID         - Circle app ID (already set)
 *   CIRCLE_ENTITY_SECRET  - 32-byte hex entity secret (must be set, see /api/debug/circle-setup)
 *   CIRCLE_WALLET_SET_ID  - Wallet set ID created from that entity secret (must be set)
 *
 * Endpoints used (all /v1/w3s):
 *   GET  /config/entity/publicKey              - get the entity's public key
 *   POST /config/entity/secret/ciphertext       - register entity secret (one-time)
 *   POST /developer/walletSets                 - create a wallet set (one-time)
 *   POST /developer/wallets                    - create a wallet
 *   GET  /developer/wallets/{id}               - get wallet details (address, balances)
 *   GET  /developer/wallets                     - list wallets
 *   POST /developer/sign/typedData              - sign EIP-712 (for x402)
 *   POST /developer/sign/message               - sign arbitrary messages
 *
 * Flow per user:
 *   1. POST /users                              - create Circle user by email
 *   2. POST /users/email/token                  - send OTP via Circle
 *   3. PUT  /users/email/authenticate           - verify OTP, get accessToken (optional)
 *   4. POST /developer/wallets                   - create DCW wallet for user
 *   5. GET  /developer/wallets/{id}              - read address
 */

import { randomUUID } from 'node:crypto';

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

async function circleFetch<T = any>(path: string, opts: { method?: string; body?: any; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<CircleResponse<T>> {
  const apiKey = API_KEY();
  if (!apiKey) return { ok: false, status: 503, error: 'CIRCLE_API_KEY not set' };

  const url = `${BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(opts.headers ?? {}),
  };

  const timeoutMs = opts.timeoutMs ?? 8000;
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
        error: json?.message ?? text.slice(0, 500),
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

/**
 * Setup helpers (one-time). Run from /api/debug/circle-setup if env vars are missing.
 */
export async function getEntityPublicKey(): Promise<CircleResponse<{ publicKey: string }>> {
  return circleFetch('/v1/w3s/config/entity/publicKey');
}

export async function registerEntitySecret(entitySecret: string, entitySecretCiphertext?: string): Promise<CircleResponse> {
  // First fetch the public key, then encrypt the entity secret with it
  if (!entitySecretCiphertext) {
    const pk = await getEntityPublicKey();
    if (!pk.ok || !pk.data?.publicKey) {
      return { ok: false, status: pk.status, error: 'failed to fetch public key: ' + (pk.error ?? 'unknown') };
    }
    const nodeCrypto = await import('node:crypto');
    try {
      const ciphertext = nodeCrypto.publicEncrypt(
        {
          key: pk.data.publicKey,
          padding: nodeCrypto.constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(entitySecret),
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
  return circleFetch('/v1/w3s/developer/walletSets', {
    method: 'POST',
    body: {
      idempotencyKey: randomUUID(),
      name,
      entitySecretCiphertext: '',  // First set uses the entity secret directly; subsequent sets need ciphertext
    },
  });
}

/**
 * User-facing operations
 */

export async function ensureUser(email: string): Promise<{ ok: boolean; userId: string; error?: string }> {
  const r = await circleFetch('/v1/w3s/users', {
    method: 'POST',
    body: { userId: email },
  });
  // 409 = already exists. That's fine.
  if (r.ok) return { ok: true, userId: email };
  if (r.status === 409) return { ok: true, userId: email };
  return { ok: false, userId: email, error: r.error };
}

export async function sendEmailOtp(email: string): Promise<CircleResponse> {
  const r = await circleFetch('/v1/w3s/users/email/token', {
    method: 'POST',
    body: { userId: email },
  });
  return r;
}

export async function verifyEmailOtp(email: string, otp: string): Promise<CircleResponse<{ accessToken?: string }>> {
  return circleFetch<{ accessToken?: string }>('/v1/w3s/users/email/authenticate', {
    method: 'PUT',
    body: { userId: email, otp },
  });
}

export async function createUserWallet(email: string): Promise<CircleResponse<{ wallet: { id: string; address: string; blockchain: string; state: string } }>> {
  const walletSetId = WALLET_SET_ID();
  if (!walletSetId) {
    return { ok: false, status: 503, error: 'CIRCLE_WALLET_SET_ID not set on Railway. Run /api/debug/circle-setup to create one.' };
  }
  if (!ENTITY_SECRET()) {
    return { ok: false, status: 503, error: 'CIRCLE_ENTITY_SECRET not set on Railway' };
  }
  return circleFetch('/v1/w3s/developer/wallets', {
    method: 'POST',
    body: {
      idempotencyKey: randomUUID(),
      walletSetId,
      accountType: 'EOA',
      blockchains: ['ARC-TESTNET'],
      count: 1,
      metadata: [{ name: 'email', value: email }],
    },
  });
}

export async function getWallet(walletId: string): Promise<CircleResponse<{ wallet: { id: string; address: string; blockchain: string; state: string; balances: any[] } }>> {
  return circleFetch(`/v1/w3s/developer/wallets/${walletId}`);
}

export async function listUserWallets(email: string): Promise<CircleResponse<{ wallets: any[] }>> {
  return circleFetch(`/v1/w3s/wallets?userId=${encodeURIComponent(email)}`);
}

/**
 * Sign an EIP-712 typed data payload with a developer-controlled wallet.
 * This is what powers the Fan Agent's x402 authorizations.
 */
export async function signTypedData(args: {
  walletId: string;
  data: string;  // JSON-stringified EIP-712 payload
}): Promise<CircleResponse<{ signature: string }>> {
  return circleFetch<{ signature: string }>('/v1/w3s/developer/sign/typedData', {
    method: 'POST',
    body: args,
  });
}

/**
 * End-to-end: provision user + wallet + return address.
 */
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

  // Check if wallet already exists
  const existing = await listUserWallets(email);
  const existingWallets = existing.data?.wallets ?? [];
  if (existing.ok && existingWallets.length > 0) {
    const w = existingWallets[0];
    steps.push(`found existing wallet ${w.id}`);
    const detail = await getWallet(w.id);
    if (detail.ok && detail.data?.wallet?.address) {
      return {
        ok: true,
        address: detail.data.wallet.address,
        walletId: w.id,
        steps,
      };
    }
  }

  const w = await createUserWallet(email);
  if (!w.ok) {
    steps.push(`createUserWallet failed: ${w.error}`);
    return { ok: false, error: w.error, steps };
  }
  const walletId = w.data?.wallet?.id;
  steps.push(`wallet ${walletId} created`);

  if (w.data?.wallet?.address) {
    steps.push(`address: ${w.data.wallet.address}`);
    return { ok: true, address: w.data.wallet.address, walletId: walletId!, steps };
  }

  // Fetch address if not in response
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

// Re-export for /api/debug/circle-setup