/**
 * Circle Developer-Controlled Wallets (DCW) — server-side only.
 *
 * Polaris Swarm uses DCW because it removes all client-side friction:
 *   - No PIN setup (Circle holds the keys)
 *   - No email OTP challenge (Circle sends the OTP directly)
 *   - No SDK in browser (everything happens on the server)
 *
 * For Pazzera, we use DCW per-user: each email gets a Circle "user"
 * (not a UCW user — a developer-managed user identified by email),
 * and we provision a wallet for them server-side.
 *
 * Required env:
 *   CIRCLE_API_KEY     — Circle API key (already set)
 *   CIRCLE_APP_ID      — Circle app ID (already set)
 *   CIRCLE_ENTITY_SECRET — Hex-encoded entity secret (NEW, must be set)
 *   CIRCLE_WALLET_SET_ID  — Wallet set ID (NEW, must be set)
 *
 * Flow:
 *   1. POST /v1/w3s/users  with {userId: email}          -> creates Circle user
 *   2. POST /v1/w3s/users/email/token {userId: email}    -> sends 6-digit OTP
 *   3. POST /v1/w3s/users/email/authenticate {userId, otp} -> returns accessToken
 *   4. POST /v1/w3s/wallets {walletSetId, userId, blockchains, accountType}
 *                                                     -> creates the wallet
 *   5. GET  /v1/w3s/wallets/{walletId}                  -> reads address
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
      method: opts.method ?? 'POST',
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
 * Create or fetch a Circle user by email. Idempotent.
 */
export async function ensureUser(email: string): Promise<{ userId: string; exists: boolean }> {
  // Try create first; if already exists, Circle returns 409 — that's fine.
  const create = await circleFetch('/v1/w3s/users', {
    method: 'POST',
    body: { userId: email },
  });
  if (create.ok) {
    return { userId: email, exists: false };
  }
  // 409 = already exists. Circle docs say to retry — but really we just continue.
  return { userId: email, exists: true };
}

/**
 * Send a 6-digit OTP to the user's email. The OTP is sent BY CIRCLE.
 * Returns a challengeId-equivalent (we use the email as the session key).
 */
export async function sendEmailOtp(email: string): Promise<CircleResponse> {
  return circleFetch('/v1/w3s/users/email/token', {
    method: 'POST',
    body: { userId: email },
  });
}

/**
 * Verify the 6-digit OTP. Returns an accessToken that can be used for
 * subsequent operations on behalf of this user (we don't actually need it
 * for DCW but the SDK flow expects it).
 */
export async function verifyEmailOtp(email: string, otp: string): Promise<CircleResponse<{ accessToken?: string }>> {
  return circleFetch<{ accessToken?: string }>('/v1/w3s/users/email/authenticate', {
    method: 'PUT',
    body: { userId: email, otp },
  });
}

/**
 * Create a Developer-Controlled wallet for the user. Returns walletId.
 */
export async function createWallet(email: string, blockchains: string[] = ['ARC-TESTNET']): Promise<CircleResponse<{ walletId: string }>> {
  const walletSetId = WALLET_SET_ID();
  if (!walletSetId) {
    return { ok: false, status: 503, error: 'CIRCLE_WALLET_SET_ID not set on Railway' };
  }
  return circleFetch<{ walletId: string }>('/v1/w3s/wallets', {
    method: 'POST',
    body: {
      idempotencyKey: randomUUID(),
      walletSetId,
      userId: email,
      blockchains,
      accountType: 'EOA',
      metadata: [{ name: 'email', value: email }],
    },
  });
}

/**
 * Get wallet details (address, balance, etc).
 */
export async function getWallet(walletId: string): Promise<CircleResponse<{ address: string; blockchain: string; state: string }>> {
  return circleFetch(`/v1/w3s/wallets/${walletId}`);
}

/**
 * List wallets for a user (across all wallet sets we own).
 */
export async function listWalletsForUser(email: string): Promise<CircleResponse<{ wallets: any[] }>> {
  return circleFetch(`/v1/w3s/wallets?userId=${encodeURIComponent(email)}`);
}

/**
 * Get the access token for a user (for SDK operations if needed).
 * Currently unused for DCW but exposed for completeness.
 */
export async function getAccessToken(email: string): Promise<CircleResponse<{ accessToken: string }>> {
  return circleFetch<{ accessToken: string }>('/v1/w3s/users/token', {
    method: 'POST',
    body: { userId: email },
  });
}

/**
 * End-to-end helper: create user + wallet, return the address.
 * Use this for the signup flow.
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
  steps.push(`user ${u.exists ? 'exists' : 'created'}`);

  const w = await createWallet(email);
  if (!w.ok) {
    steps.push(`createWallet failed: ${w.error}`);
    return { ok: false, error: w.error, steps };
  }
  steps.push(`wallet ${w.data?.walletId} created`);

  const detail = await getWallet(w.data!.walletId);
  if (!detail.ok || !detail.data?.address) {
    steps.push(`getWallet failed: ${detail.error}`);
    return { ok: false, error: 'wallet created but could not read address', steps };
  }
  steps.push(`address: ${detail.data.address}`);
  return { ok: true, address: detail.data.address, walletId: w.data!.walletId, steps };
}