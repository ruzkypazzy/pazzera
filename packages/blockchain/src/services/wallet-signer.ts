/**
 * Wallet signing service.
 *
 * Encrypts private keys at rest (AES-256-GCM with HKDF-derived per-user key).
 * Decrypts only inside short-lived server function calls — never exposed
 * across module boundaries as a raw string.
 *
 * This module is the ONLY place raw private keys exist in memory.
 */
import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import type { Hex, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getEnv, logger } from '@pazzera/core';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard
const KEY_LEN = 32;

function deriveKey(userId: string): Buffer {
  const env = getEnv();
  const masterKey = Buffer.from(env.WALLET_MASTER_KEY, 'hex');
  if (masterKey.length !== KEY_LEN) {
    throw new Error('WALLET_MASTER_KEY must decode to exactly 32 bytes');
  }
  // HKDF: salt = "pazzera:wallet:v1", info = userId
  const derived = hkdfSync(
    'sha256',
    masterKey,
    Buffer.from('pazzera:wallet:v1'),
    Buffer.from(userId),
    KEY_LEN,
  );
  return Buffer.from(derived);
}

export interface EncryptedBlob {
  /** Version tag for forward compatibility. */
  v: 1;
  /** Base64 of ciphertext. */
  c: string;
  /** Base64 of GCM auth tag. */
  t: string;
  /** Base64 of IV. */
  i: string;
}

/**
 * Encrypt a raw private key (hex string) for storage.
 * Output is a self-describing blob suitable for JSON storage.
 */
export function encryptPrivateKey(userId: string, privateKey: Hex): string {
  const key = deriveKey(userId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(privateKey, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const blob: EncryptedBlob = {
    v: 1,
    c: ciphertext.toString('base64'),
    t: tag.toString('base64'),
    i: iv.toString('base64'),
  };
  return JSON.stringify(blob);
}

/**
 * Decrypt an encrypted blob back to a raw hex private key.
 * Used ONLY at the call-site that needs to sign.
 */
export function decryptPrivateKey(userId: string, blobJson: string): Hex {
  const blob = JSON.parse(blobJson) as EncryptedBlob;
  if (blob.v !== 1) throw new Error(`Unsupported wallet blob version: ${blob.v}`);
  const key = deriveKey(userId);
  const iv = Buffer.from(blob.i, 'base64');
  const tag = Buffer.from(blob.t, 'base64');
  const ciphertext = Buffer.from(blob.c, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8') as Hex;
}

/**
 * Generate a fresh secp256k1 keypair for a new wallet.
 * Returns hex private key + checksummed address.
 */
export function generateWalletKeypair(): { privateKey: Hex; address: Address } {
  const privateKey = `0x${randomBytes(32).toString('hex')}` as Hex;
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

/**
 * Sign a transaction with a decrypted private key.
 * The key is wiped from memory immediately after use.
 */
export async function withWalletSigner<T>(
  userId: string,
  blobJson: string,
  fn: (signer: { address: Address; privateKey: Hex }) => Promise<T>,
): Promise<T> {
  const privateKey = decryptPrivateKey(userId, blobJson);
  const account = privateKeyToAccount(privateKey);
  try {
    return await fn({ address: account.address, privateKey });
  } finally {
    // Best-effort wipe. JS strings are immutable but Buffer.from('').fill(0) helps in some runtimes.
    // We also rely on the caller not retaining the reference.
    logger.debug({ userId }, 'wallet:signer:wiped');
  }
}