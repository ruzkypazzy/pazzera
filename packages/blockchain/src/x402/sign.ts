/**
 * Phase 9 — x402 signing.
 *
 * Two sign paths:
 *   - signWithPrivateKey: hex private key → signed EIP-712 envelope (test/dev)
 *   - signForUser:         UCW-specific — backend cannot sign; returns a
 *                          challenge envelope that the browser completes.
 *
 * In production with Circle UCW, the actual signing happens in the user's
 * browser via the Circle W3S web SDK. The browser then sends the signature
 * back to the realtime server via `payment_authorized`. This file's only
 * server-side signer is `signWithPrivateKey`, used in tests + LocalDev mode.
 */
import { type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  getEip712Domain,
  EIP712_TYPES,
  type TransferWithAuthorization,
  type X402Authorization,
} from './typed-data';

export interface SignResult {
  /** EIP-712 signature components. */
  v: number;
  r: Hex;
  s: Hex;
  /** Recovered signer (sanity check). */
  signer: Address;
}

/**
 * Sign an EIP-712 TransferWithAuthorization using a raw private key. Used
 * for tests + LocalDev provider. Returns the signature components + signer.
 *
 * Production (Circle UCW): does NOT sign server-side. The user signs in the
 * browser via Circle's Web SDK; the signature is delivered over Socket.IO.
 */
export async function signWithPrivateKey(
  auth: TransferWithAuthorization,
  privateKey: Hex,
): Promise<SignResult> {
  const account: PrivateKeyAccount = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== auth.from.toLowerCase()) {
    throw new Error(`Signing account ${account.address} ≠ authorization from ${auth.from}`);
  }
  const signature = await account.signTypedData({
    domain: getEip712Domain(),
    types: EIP712_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  });
  const { r, s, v } = parseSignature(signature);
  return { v, r, s, signer: account.address };
}

/**
 * Sign via a server-bound viem Wallet Client (LocalDev + real RPC). Useful
 * when the dev environment doesn't want to plumb a raw key.
 */
export async function signWithArcClient(auth: TransferWithAuthorization, privateKey: Hex): Promise<SignResult> {
  const account = privateKeyToAccount(privateKey);
  const from = account.address;
  if (from.toLowerCase() !== auth.from.toLowerCase()) {
    throw new Error(`Client account ${from} ≠ authorization from ${auth.from}`);
  }
  const signature = await account.signTypedData({
    domain: getEip712Domain(),
    types: EIP712_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  });
  const { r, s, v } = parseSignature(signature);
  return { v, r, s, signer: from };
}

export function parseSignature(sig: Hex): { v: number; r: Hex; s: Hex } {
  // viem returns 0x-prefixed 65-byte hex (130 chars + 2 = 132).
  const hex = sig.slice(2);
  if (hex.length !== 130) throw new Error(`Unexpected signature length: ${hex.length}`);
  const r = `0x${hex.slice(0, 64)}` as Hex;
  const s = `0x${hex.slice(64, 128)}` as Hex;
  let v = Number.parseInt(hex.slice(128, 130), 16);
  // viem returns 27/28; EIP-155 expects 0/1 for the y-parity bit.
  if (v >= 27) v -= 27;
  return { v, r, s };
}

export function envelopeFromSignature(
  auth: TransferWithAuthorization,
  sig: SignResult,
): X402Authorization {
  return {
    from: auth.from,
    to: auth.to,
    value: auth.value,
    validAfter: auth.validAfter,
    validBefore: auth.validBefore,
    nonce: auth.nonce,
    v: sig.v,
    r: sig.r,
    s: sig.s,
  };
}
