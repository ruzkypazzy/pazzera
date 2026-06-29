/**
 * EIP-712 helpers for USDC TransferWithAuthorization.
 *
 * Builds the typed data + signing function clients use to authorize a
 * pay-per-listen nano payment. The signed payload is sent to Circle Gateway
 * facilitator for settlement (no gas cost to the user).
 */
import { type Address, type Hex, hashTypedData, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getEnv } from '@pazzera/core';

export interface TransferWithAuthorization {
  from: Address;
  to: Address;
  value: string; // decimal string in base units (6 decimals)
  validAfter: string; // unix seconds
  validBefore: string; // unix seconds
  nonce: Hex; // 32 bytes
}

export function getEip712Domain() {
  const env = getEnv();
  return {
    name: 'USDC',
    version: '2',
    chainId: env.ARC_CHAIN_ID,
    verifyingContract: env.USDC_CONTRACT_ADDRESS as Address,
  } as const;
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

/** Generate a random 32-byte nonce for a one-time authorization. */
export function newNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

/** Hash the EIP-712 typed data — used as the structureHash reference. */
export function hashAuthorization(auth: TransferWithAuthorization): Hex {
  return hashTypedData({
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
}

/**
 * Sign an authorization with a private key. Returns v, r, s ready to ship
 * to Circle Gateway.
 */
export function signAuthorization(
  privateKey: Hex,
  auth: TransferWithAuthorization,
): { v: number; r: Hex; s: Hex } {
  const account = privateKeyToAccount(privateKey);
  const signature = account.signTypedData({
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

  const r = signature.slice(0, 66) as Hex;
  const s = (`0x${signature.slice(66, 130)}`) as Hex;
  const v = parseInt(signature.slice(130, 132), 16);

  return { v, r, s };
}

/**
 * Recover the signer address from a signed authorization — used by
 * the Fan Agent worker to verify the signature before settling.
 */
export async function recoverAuthorizationSigner(
  auth: TransferWithAuthorization,
  sig: { v: number; r: Hex; s: Hex },
): Promise<Address> {
  const signature = `${sig.r.slice(2)}${sig.s.slice(2)}${sig.v.toString(16).padStart(2, '0')}` as Hex;
  return recoverTypedDataAddress({
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
    signature,
  });
}