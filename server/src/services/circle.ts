/**
 * Circle W3S (Wallets-as-a-Service) integration.
 *
 * This module wraps the Circle Developer-Controlled Wallets SDK so the rest
 * of the codebase can stay clean. Two main flows:
 *
 *  1. createArtistWallet(email) — provision a wallet for an artist on signup,
 *     pre-funded with testnet USDC via the Canteen faucet.
 *  2. createFanSession(email)  — provision (or fetch) a wallet for a fan at
 *     play time, also pre-funded. Email-keyed so the same fan returns to the
 *     same wallet.
 *
 * Real implementation uses @circle-fin/developer-controlled-wallets. During
 * the hackathon build we mock the network call with an in-memory map so the
 * rest of the system can be tested end-to-end without API keys. To switch to
 * real Circle, drop in the SDK calls where marked "// REAL:".
 */

import { randomUUID } from 'node:crypto';

// In-memory mock of Circle W3S + Arc testnet state.
// In production, replace with @circle-fin/developer-controlled-wallets calls.
const walletByEmail = new Map<string, { walletId: string; address: string }>();
const faucetByAddress = new Map<string, number>(); // USDC pre-funded

// Deterministic-looking testnet address generator (mock)
function mockAddress(seed: string): string {
  const hex = Array.from(seed).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return '0x' + hex.toString(16).padStart(8, '0') + randomUUID().replace(/-/g, '').slice(0, 32);
}

export async function createArtistWallet(email: string) {
  // REAL: const circle = new CircleDeveloperControlledWallets({ apiKey: process.env.CIRCLE_API_KEY });
  // REAL: const set = await circle.createWalletSet({ name: `pazzera-${email}` });
  // REAL: const wallet = await circle.createWallet({ walletSetId: set.id, blockchains: ['ARC-TESTNET'], accountType: 'EOA' });

  const existing = walletByEmail.get(email);
  if (existing) return existing;

  const walletId = `wlt_${randomUUID().slice(0, 8)}`;
  const address = mockAddress(email);
  walletByEmail.set(email, { walletId, address });

  // Pre-fund from Canteen faucet (mock)
  // REAL: await fetch(process.env.FAUCET_URL, { method: 'POST', body: JSON.stringify({ address }) })
  faucetByAddress.set(address, 100); // 100 testnet USDC

  return { walletId, address };
}

export async function getFanWallet(email: string) {
  return createArtistWallet(email); // same logic; artist/fan are both wallets
}

export async function fundWalletFromFaucet(address: string): Promise<number> {
  // REAL: call Canteen faucet
  const amount = faucetByAddress.get(address) ?? 0;
  if (amount === 0) {
    faucetByAddress.set(address, 5); // first-time fan gets 5 USDC
    return 5;
  }
  return amount;
}

export interface X402Authorization {
  payerAddress: string;
  payeeAddress: string;
  amountUsdc: string;
  resourceId: string;        // track id
  nonce: string;
  validUntil: number;        // unix ms
  signature: string;         // EIP-3009 signature (mocked here)
}

/**
 * Verify an x402 authorization header. In real life this is an EIP-3009
 * transferWithAuthorization signature check on USDC. For the hackathon we
 * accept any well-formed auth and stamp it as settled.
 */
export function verifyX402Auth(auth: X402Authorization): boolean {
  if (!auth.payerAddress || !auth.payeeAddress) return false;
  if (Number(auth.amountUsdc) <= 0) return false;
  if (auth.validUntil < Date.now()) return false;
  return auth.signature.length > 0;
}

/**
 * Mock settlement: in real life, the facilitator batches many signed
 * authorizations into one Gateway settlement on Arc. Here we just record
 * it and return a fake tx hash.
 */
export async function settleOnArc(auth: X402Authorization): Promise<string> {
  // REAL: await circle.submitGatewayBatch({ authorizations: [auth] })
  const txHash = '0x' + randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 32);
  return txHash;
}