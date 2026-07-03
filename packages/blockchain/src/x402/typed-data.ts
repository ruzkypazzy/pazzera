/**
 * Phase 9 — x402 typed-data module.
 *
 * The x402 payment envelope is two layers:
 *   - Inner: EIP-712 TransferWithAuthorization (USDC on Arc)
 *   - Outer: x402 envelope carrying the signature + network + facilitator URL
 *
 * This file owns the canonical types + JSON shape. `sign.ts` and `verify.ts`
 * consume them. Deterministic helpers live here so callers don't reinvent
 * the nonce-generation or domain-construction logic.
 */
import { randomBytes } from 'node:crypto';
import { type Address, type Hex } from 'viem';
import { getEnv } from '@pazzera/core';

/** Inner EIP-3009 payload (USDC TransferWithAuthorization). */
export interface TransferWithAuthorization {
  from: Address;
  to: Address;
  value: string;          // decimal string of USDC base units (6 decimals)
  validAfter: string;     // unix seconds, hex string
  validBefore: string;    // unix seconds, hex string
  nonce: Hex;             // 32-byte hex nonce
}

/** Outer x402 envelope. */
export interface X402Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  v: number;
  r: Hex;
  s: Hex;
  /** Asset contract address (e.g. USDC). Required for x402 Gateway. */
  asset?: Address;
}

/** Network identifier in CAIP-2-ish form, e.g. "eip155:5042002" for Arc. */
export interface X402Network {
  name: 'arc-testnet';
  caip2: `eip155:${number}`;
  chainId: number;
}

export function getX402Network(): X402Network {
  const env = getEnv();
  return {
    name: 'arc-testnet',
    caip2: `eip155:${env.ARC_CHAIN_ID}`,
    chainId: env.ARC_CHAIN_ID,
  };
}

/** EIP-712 domain for USDC on Arc testnet. */
export function getEip712Domain() {
  const env = getEnv();
  return {
    name: 'USDC' as const,
    version: '2' as const,
    chainId: env.ARC_CHAIN_ID,
    verifyingContract: env.USDC_CONTRACT_ADDRESS as Address,
  };
}

export const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** Build a TransferWithAuthorization payload that is valid for the next 60s. */
export function buildAuthorization(opts: {
  from: Address;
  to: Address;
  amountBaseUnits: string;
  nowSec?: number;
}): TransferWithAuthorization {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  return {
    from: opts.from,
    to: opts.to,
    value: BigInt(opts.amountBaseUnits).toString(),
    validAfter: BigInt(now).toString(),
    // validBefore <= now + 60s per spec rule
    validBefore: BigInt(now + 60).toString(),
    nonce: newAuthNonce(),
  };
}

/** Cryptographic 32-byte nonce, hex-encoded with 0x prefix. */
export function newAuthNonce(): Hex {
  const bytes = randomBytes(32);
  return `0x${bytes.toString('hex')}` as Hex;
}

/** Validate that an authorization's validBefore is within the 60s window. */
export function isAuthorizationFresh(auth: TransferWithAuthorization, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const va = Number.parseInt(auth.validAfter, 10);
  const vb = Number.parseInt(auth.validBefore, 10);
  if (Number.isNaN(va) || Number.isNaN(vb)) return false;
  if (va < 0 || vb < 0) return false;
  if (vb > nowSec + 60) return false; // spec: max 60s future
  if (vb <= nowSec) return false;       // not yet valid? actually expired
  return true;
}

/** Pretty-print an x402 authorization for logs / demos. */
export function formatAuth(auth: TransferWithAuthorization | X402Authorization): string {
  return `${(auth.from as string).slice(0, 8)}→${(auth.to as string).slice(0, 8)} value=${auth.value} nonce=${(auth.nonce as string).slice(0, 12)}`;
}
