/**
 * Phase 9 — x402 verification.
 *
 * The facilitator MUST verify the signature BEFORE submitting to the chain.
 * Without verification, a malicious listener could submit envelopes signed
 * by some other address — and the on-chain settlement would draw from the
 * wrong wallet. Triple-check:
 *   1. EIP-712 signature recovers `from`
 *   2. validBefore is fresh (≤ 60s in the future, ≥ now)
 *   3. nonce hasn't been used before (Redis + Postgres double check)
 */
import { type Address, type Hex, recoverTypedDataAddress, hashTypedData } from 'viem';
import {
  getEip712Domain,
  EIP712_TYPES,
  isAuthorizationFresh,
  type TransferWithAuthorization,
  type X402Authorization,
} from './typed-data';

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  recoveredFrom?: Address;
  digest?: Hex;
}

/**
 * Verify the cryptographic portion of an x402 envelope.
 * Does NOT check nonce reuse — the caller must do that with
 * consumeNonce() after this returns valid.
 */
export async function verifyAuthorizationSignature(envelope: X402Authorization): Promise<VerifyResult> {
  const auth: TransferWithAuthorization = {
    from: envelope.from,
    to: envelope.to,
    value: envelope.value,
    validAfter: envelope.validAfter,
    validBefore: envelope.validBefore,
    nonce: envelope.nonce,
  };
  if (!isAuthorizationFresh(auth)) {
    return { valid: false, reason: 'authorization_not_fresh' };
  }
  if (!isShape(envelope)) {
    return { valid: false, reason: 'malformed_envelope' };
  }
  // Try both possible v values (viem standard is 27/28, EIP-155 expects 0/1;
  // some clients use one convention, some the other).
  const v27 = envelope.v >= 27 ? envelope.v : envelope.v + 27;
  const sigHex = `${envelope.r}${envelope.s.slice(2)}${v27.toString(16).padStart(2, '0')}` as Hex;
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
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
      signature: sigHex,
    });
  } catch (err) {
    return { valid: false, reason: 'signature_decode_failed' };
  }
  if (recovered.toLowerCase() !== envelope.from.toLowerCase()) {
    return { valid: false, reason: 'signer_mismatch', recoveredFrom: recovered };
  }
  const digest = hashTypedData({
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
  return { valid: true, recoveredFrom: recovered, digest };
}

export function isShape(env: X402Authorization): boolean {
  if (!env.from?.startsWith('0x')) return false;
  if (!env.to?.startsWith('0x')) return false;
  if (!env.nonce?.startsWith('0x') || env.nonce.length !== 66) return false;
  if (!env.r?.startsWith('0x') || env.r.length !== 66) return false;
  if (!env.s?.startsWith('0x') || env.s.length !== 66) return false;
  if (typeof env.v !== 'number' || env.v < 0 || env.v > 28) return false;
  if (!/^\d+$/.test(env.value) || !/^\d+$/.test(env.validAfter) || !/^\d+$/.test(env.validBefore)) return false;
  return true;
}

export { isAuthorizationFresh } from './typed-data';
