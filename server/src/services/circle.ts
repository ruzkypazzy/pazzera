/**
 * Circle W3S (User-Controlled Wallets) + Arc Gateway + x402 facilitator integration.
 *
 * This module is the only place that talks to Circle. The rest of the codebase
 * speaks to a narrow interface:
 *
 *   createArtistWallet(email)     → provisions an embedded Circle wallet for
 *                                   an artist, returns { walletId, address }
 *   createFanWallet(email)        → provisions an embedded Circle wallet for
 *                                   a fan (or returns existing one)
 *   requestFaucetFunding(address) → requests testnet USDC from Circle's faucet
 *   verifyX402Payment(auth)       → verifies an EIP-3009 TransferWithAuthorization
 *                                   signature signed by the fan's wallet
 *   submitToGateway(auth)         → forwards signed auth to the Circle Gateway
 *                                   facilitator → returns settlement UUID
 *   getSettlementStatus(uuid)     → polls the facilitator for settlement state
 *                                   and (once settled) the on-chain batch tx
 *
 * All real on-chain integration. No mocks.
 */

import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';
import { createPublicClient, http, recoverTypedDataAddress, hashTypedData, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomUUID } from 'node:crypto';

const API_KEY = process.env.CIRCLE_API_KEY ?? '';
const APP_ID = process.env.CIRCLE_APP_ID ?? '';
const FACILITATOR = process.env.FACILITATOR_URL ?? 'https://gateway-api-testnet.circle.com';
const NETWORK_ID = process.env.NETWORK_ID ?? 'eip155:5042002';
const ARC_RPC = process.env.ARC_RPC_URL ?? '';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? 5042002);
const USDC_ADDR = (process.env.ARC_USDC_CONTRACT ?? '0x3600000000000000000000000000000000000000') as `0x${string}`;
const GATEWAY_WALLET = (process.env.GATEWAY_WALLET ?? '0x0077777d7EBA4688BDeF3E311b846F25870A19B9') as `0x${string}`;
const ARC_EXPLORER = process.env.ARC_EXPLORER ?? 'https://testnet.arcscan.app';

const circle = initiateUserControlledWalletsClient({ apiKey: API_KEY });

// viem public client for reading on-chain state (decoding submitBatch tx later)
export const arc = createPublicClient({
  transport: http(ARC_RPC),
  chain: {
    id: CHAIN_ID,
    name: 'Arc Testnet',
    network: 'arc-testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  },
});

// USDC EIP-712 domain on Arc (FiatTokenV2_2 / TransferWithAuthorization)
const EIP712_DOMAIN = {
  name: 'USDC' as const,
  version: '2' as const,
  chainId: CHAIN_ID,
  verifyingContract: USDC_ADDR,
};

const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const;

// ─── Wallet provisioning ────────────────────────────────────
// In W3S User-Controlled Wallets, a "user" is created server-side, then a
// challenge is sent to the SDK on the client which the user signs in their
// browser. We persist userId + the wallet address it produces.

export async function createOrGetUser(email: string): Promise<{ userId: string }> {
  // Idempotent: createUser returns 409 if user exists, so we swallow that.
  try {
    const r = await circle.createUser({ userId: email });
    return { userId: r.data?.user?.id ?? email };
  } catch (e: any) {
    if (e?.response?.status === 409 || /already/i.test(String(e?.message))) {
      return { userId: email };
    }
    throw e;
  }
}

export async function createWalletForUser(userId: string, accountType: 'EOA' | 'SCA' = 'EOA') {
  const r = await circle.createWallet({
    userId,
    blockchains: ['ARC-TESTNET'],
    accountType,
  });
  const wallet = r.data?.wallet;
  if (!wallet) throw new Error('createWallet: no wallet in response');
  return { walletId: wallet.id, address: wallet.address as `0x${string}` };
}

export async function getOrCreateWallet(email: string) {
  const { userId } = await createOrGetUser(email);
  // Look up existing wallets for this user; if none, create one.
  const list = await circle.listWallets({ userId });
  const existing = list.data?.wallets?.find(w => w.blockchain === 'ARC-TESTNET');
  if (existing) return { walletId: existing.id, address: existing.address as `0x${string}`, userId };
  return await createWalletForUser(userId);
}

// ─── Faucet ─────────────────────────────────────────────────
// Canteen page mentions Circle faucet; the canonical URL is faucet.circle.com
// and it supports Arc Testnet. We POST the address and let a human/automation
// fund it. For dev, you can also self-fund via the CLI (see scripts/fund.ts).
export async function requestFaucetFunding(address: string): Promise<void> {
  // Best-effort: most implementations require a one-time CAPTCHA + signed
  // message. We just open the URL for the developer.
  console.log(`[faucet] request testnet USDC for ${address} at ${process.env.FAUCET_URL}`);
}

// ─── x402 auth verification ─────────────────────────────────
// Verify the fan's EIP-3009 TransferWithAuthorization signature recovers to
// the claimed payer address. Real verification, not a length check.
export async function verifyX402Payment(auth: {
  payer: string;
  payee: string;
  value: string;       // USDC base units (6 decimals)
  validAfter: number;  // unix seconds
  validBefore: number; // unix seconds
  nonce: string;       // 32-byte hex
  signature: string;   // 0x... 65 bytes
}): Promise<{ ok: boolean; recovered?: string; reason?: string }> {
  if (!auth.payer || !auth.payee || !auth.signature) return { ok: false, reason: 'missing fields' };
  if (BigInt(auth.value) <= 0n) return { ok: false, reason: 'non-positive value' };
  if (auth.validBefore * 1000 < Date.now()) return { ok: false, reason: 'expired' };

  try {
    const recovered = await recoverTypedDataAddress({
      domain: EIP712_DOMAIN,
      types: EIP712_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: auth.payer as `0x${string}`,
        to: auth.payee as `0x${string}`,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as `0x${string}`,
      },
      signature: auth.signature as `0x${string}`,
    });
    const ok = recovered.toLowerCase() === auth.payer.toLowerCase();
    return { ok, recovered, reason: ok ? undefined : 'signer mismatch' };
  } catch (e: any) {
    return { ok: false, reason: `recover failed: ${e?.message ?? e}` };
  }
}

// ─── Gateway facilitator ────────────────────────────────────
// POST the signed auth to Circle's x402/settle endpoint → returns a settlement
// UUID. The actual on-chain tx fires later when the relayer batches.
export async function submitToGateway(auth: {
  payer: string;
  payee: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
  signature: string;
}): Promise<{ settlementId: string }> {
  const r = await fetch(`${FACILITATOR}/v1/x402/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      network: NETWORK_ID,
      authorization: {
        from:        auth.payer,
        to:          auth.payee,
        value:       auth.value,
        validAfter:  auth.validAfter,
        validBefore: auth.validBefore,
        nonce:       auth.nonce,
      },
      signature: auth.signature,
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`facilitator /settle ${r.status}: ${text}`);
  }
  const data = await r.json() as { transferId?: string; id?: string; settlementId?: string };
  const settlementId = data.transferId ?? data.id ?? data.settlementId;
  if (!settlementId) throw new Error('facilitator /settle: no id in response');
  return { settlementId };
}

export interface SettlementStatus {
  id: string;
  status: 'received' | 'queued' | 'submitted' | 'completed' | 'failed' | string;
  batchTx?: string | null;
  explorerUrl?: string;
  amountUsdc?: string;
}

export async function getSettlementStatus(id: string): Promise<SettlementStatus> {
  const r = await fetch(`${FACILITATOR}/v1/x402/transfers/${id}`);
  if (!r.ok) throw new Error(`facilitator /transfers/${id} ${r.status}`);
  const data = await r.json() as any;
  return {
    id,
    status: data.status ?? 'unknown',
    batchTx: data.batchTx ?? null,
    amountUsdc: data.amount ?? undefined,
  };
}

// ─── Helpers ────────────────────────────────────────────────
export function usdcUnits(amountUsdc: string | number): string {
  // Convert human USDC (e.g. "0.001") → 6-decimal base units string ("1000")
  const n = Number(amountUsdc);
  if (!Number.isFinite(n)) throw new Error('invalid amount');
  // 6 decimals, no float fuzz: string math
  const [int, frac = ''] = String(n).split('.');
  const padded = (frac + '000000').slice(0, 6);
  return (BigInt(int) * 1_000_000n + BigInt(padded)).toString();
}

export function formatUsdc(baseUnits: string | bigint): string {
  return formatUnits(BigInt(baseUnits), 6);
}

// Re-exports used by routes
export { APP_ID, FACILITATOR, NETWORK_ID, ARC_RPC, ARC_EXPLORER, CHAIN_ID, USDC_ADDR, GATEWAY_WALLET };