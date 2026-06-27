/**
 * Circle W3S (User-Controlled Wallets) + Arc Gateway + x402 facilitator.
 *
 * This is the only module that talks to Circle. Two surfaces:
 *
 *   Wallet provisioning (PIN flow, fan-owned):
 *     createUser(userId)
 *     createUserToken(userId)             → { userToken, encryptionKey }
 *     createUserPinWithWallets(userToken, blockchains, accountType)
 *                                          → { challengeId } (frontend runs sdk.execute)
 *     listWallets(userToken)              → { wallets: [{id, address, blockchain}] }
 *
 *   x402 payment rail:
 *     verifyX402Payment(auth)             → EIP-712 sig recovery
 *     submitToGateway(auth)               → POST /v1/x402/settle → settlementId
 *     getSettlementStatus(id)             → GET /v1/x402/transfers/:id
 *
 * All real on-chain. No mocks.
 */

import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';
import { createPublicClient, http, recoverTypedDataAddress, formatUnits } from 'viem';
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

// viem public client (decoding submitBatch tx, reading balances)
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

// USDC EIP-712 domain (FiatTokenV2_2 TransferWithAuthorization)
export const EIP712_DOMAIN = {
  name: 'USDC' as const,
  version: '2' as const,
  chainId: CHAIN_ID,
  verifyingContract: USDC_ADDR,
};

export const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const;

// ─── Wallet provisioning (PIN flow) ────────────────────────

export async function createUser(userId: string) {
  const r = await circle.createUser({ userId });
  return r.data;
}

export async function createUserToken(userId: string): Promise<{ userToken: string; encryptionKey: string }> {
  const r = await circle.createUserToken({ userId });
  return {
    userToken: (r.data as any)?.userToken,
    encryptionKey: (r.data as any)?.encryptionKey,
  };
}

export async function createUserPinWithWallets(
  userToken: string,
  blockchains: string[],
  accountType: 'EOA' | 'SCA' = 'SCA',
): Promise<{ challengeId: string }> {
  const r = await (circle as any).createUserPinWithWallets({
    userToken,
    blockchains,
    accountType,
  });
  const challengeId = r.data?.challengeId;
  if (!challengeId) throw new Error('createUserPinWithWallets: no challengeId in response');
  return { challengeId };
}

export async function listWallets(userToken: string): Promise<{ wallets: Array<{ id: string; address: string; blockchain: string }> }> {
  // Circle SDK v10.x wrapper: listWallets({ userToken, ... }) — SDK class wrapper takes a filter object
  const r = await (circle as any).listWallets({ userToken });
  return { wallets: (r?.data as any)?.wallets ?? [] };
}

// ─── Faucet ────────────────────────────────────────────────
export function requestFaucetFunding(address: string): void {
  console.log(`[faucet] request testnet USDC for ${address} at ${process.env.FAUCET_URL}`);
}

// ─── x402 auth verification ────────────────────────────────
export interface X402Auth {
  payer: string;
  payee: string;
  value: string;       // USDC base units (6 decimals)
  validAfter: number;
  validBefore: number;
  nonce: string;
  signature: string;
}

export async function verifyX402Payment(auth: X402Auth): Promise<{ ok: boolean; recovered?: string; reason?: string }> {
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

// ─── Gateway facilitator ──────────────────────────────────
export async function submitToGateway(auth: X402Auth): Promise<{ settlementId: string }> {
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
  status: string;
  batchTx?: string | null;
  explorerUrl?: string | null;
}

export async function getSettlementStatus(id: string): Promise<SettlementStatus> {
  const r = await fetch(`${FACILITATOR}/v1/x402/transfers/${id}`);
  if (!r.ok) throw new Error(`facilitator /transfers/${id} ${r.status}`);
  const data = await r.json() as any;
  return {
    id,
    status: data.status ?? 'unknown',
    batchTx: data.batchTx ?? null,
    explorerUrl: data.batchTx ? `${ARC_EXPLORER}/tx/${data.batchTx}` : null,
  };
}

// ─── Helpers ───────────────────────────────────────────────
export function usdcUnits(amountUsdc: string | number): string {
  const n = Number(amountUsdc);
  if (!Number.isFinite(n)) throw new Error('invalid amount');
  const [int, frac = ''] = String(n).split('.');
  const padded = (frac + '000000').slice(0, 6);
  const intPart = int ?? '0';
  const fracPart = padded || '0';
  return (BigInt(intPart) * 1_000_000n + BigInt(fracPart)).toString();
}

export function formatUsdc(baseUnits: string | bigint): string {
  return formatUnits(BigInt(baseUnits), 6);
}

// Re-exports used by routes
export { APP_ID, FACILITATOR, NETWORK_ID, ARC_RPC, ARC_EXPLORER, CHAIN_ID, USDC_ADDR, GATEWAY_WALLET };