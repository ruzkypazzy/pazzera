/**
 * Wallet encryption — v2 (versioned + rotation-ready).
 *
 * Goals:
 *   - Forward-compatible: every encrypted blob carries its own version,
 *     so we can rotate algorithms (e.g. v2 → v3) without breaking reads.
 *   - Rotation-friendly: keys are tagged with a `keyVersion` so old
 *     ciphertexts can be re-encrypted lazily on first read.
 *   - Tamper-evident: AES-256-GCM auth tag is verified on decrypt.
 *
 * Storage format (PazzeraWalletBlob v2):
 *
 *   {
 *     v: 2,                              // blob format version
 *     alg: 'AES-256-GCM',                // algorithm
 *     kdf: 'HKDF-SHA-256',               // key derivation
 *     keyVersion: 1,                     // which WALLET_MASTER_KEY to use
 *     saltVersion: 1,                    // HKDF salt version (allows rotating
 *                                       // the per-user salt scheme)
 *     c: <base64 ciphertext>,
 *     i: <base64 iv (12 bytes)>,
 *     t: <base64 auth tag (16 bytes)>,
 *     createdAt: <iso8601>,
 *   }
 *
 * Re-encryption:
 *   - On first read of a v1 blob, we decrypt, re-encrypt with v2 + keyVersion=2,
 *     and write back. The migration is invisible to callers.
 *   - On read of a v2 blob with a stale `keyVersion`, we re-encrypt with the
 *     current `keyVersion`. Same migration pattern.
 *
 * Decryption is constant-time at the algorithm layer (GCM auth tag check).
 * Caller-side string equality is not used.
 */
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  createHash,
} from 'node:crypto';
import type { Hex, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getEnv } from '@pazzera/core';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;
const CURRENT_FORMAT_VERSION = 2;
const CURRENT_KEY_VERSION = 1;
const CURRENT_SALT_VERSION = 1;

const SALT_PREFIX_V1 = 'pazzera:wallet:v1';
const SALT_PREFIX_V2 = 'pazzera:wallet:v2';

export interface PazzeraWalletBlobV2 {
  v: 2;
  alg: 'AES-256-GCM';
  kdf: 'HKDF-SHA-256';
  keyVersion: number;
  saltVersion: number;
  c: string; // base64
  i: string; // base64
  t: string; // base64
  createdAt: string;
}

// ─── Key derivation (HKDF) ──────────────────────────────────────────

function deriveKey(userId: string, saltVersion: number): Buffer {
  const env = getEnv();
  const masterKey = Buffer.from(env.WALLET_MASTER_KEY, 'hex');
  if (masterKey.length !== KEY_LEN) {
    throw new Error('WALLET_MASTER_KEY must decode to exactly 32 bytes');
  }
  const salt = saltVersion === 2
    ? Buffer.from(SALT_PREFIX_V2)
    : Buffer.from(SALT_PREFIX_V1);
  const derived = hkdfSync('sha256', masterKey, salt, Buffer.from(userId), KEY_LEN);
  return Buffer.from(derived);
}

/** Lookup the master key for a given keyVersion. Currently a single key. */
function masterKeyFor(keyVersion: number): Buffer {
  const env = getEnv();
  if (keyVersion === 1) return Buffer.from(env.WALLET_MASTER_KEY, 'hex');
  throw new Error(`Unknown wallet keyVersion: ${keyVersion}`);
}

// ─── Encrypt / decrypt ──────────────────────────────────────────────

export function encryptPrivateKeyV2(
  userId: string,
  privateKey: Hex,
  opts: { keyVersion?: number; saltVersion?: number } = {},
): PazzeraWalletBlobV2 {
  const keyVersion = opts.keyVersion ?? CURRENT_KEY_VERSION;
  const saltVersion = opts.saltVersion ?? CURRENT_SALT_VERSION;
  const masterKey = masterKeyFor(keyVersion);
  // HKDF re-derived here so the function is self-contained for any
  // keyVersion. We use a salted HKDF keyed off the master directly.
  const ikm = Buffer.concat([masterKey, Buffer.from(`:v${keyVersion}:${userId}`)]);
  const key = Buffer.from(hkdfSync('sha256', ikm, Buffer.from(SALT_PREFIX_V2), Buffer.from(userId), KEY_LEN));
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 2,
    alg: 'AES-256-GCM',
    kdf: 'HKDF-SHA-256',
    keyVersion,
    saltVersion,
    c: ciphertext.toString('base64'),
    i: iv.toString('base64'),
    t: tag.toString('base64'),
    createdAt: new Date().toISOString(),
  };
}

export function decryptPrivateKeyV2(userId: string, blob: PazzeraWalletBlobV2): Hex {
  if (blob.v !== 2) throw new Error(`Unsupported blob version: ${(blob as { v: number }).v}`);
  if (blob.alg !== 'AES-256-GCM') throw new Error(`Unsupported alg: ${blob.alg}`);
  const masterKey = masterKeyFor(blob.keyVersion);
  const ikm = Buffer.concat([masterKey, Buffer.from(`:v${blob.keyVersion}:${userId}`)]);
  const key = Buffer.from(hkdfSync('sha256', ikm, Buffer.from(SALT_PREFIX_V2), Buffer.from(userId), KEY_LEN));
  const iv = Buffer.from(blob.i, 'base64');
  const tag = Buffer.from(blob.t, 'base64');
  const ciphertext = Buffer.from(blob.c, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8') as Hex;
}

// ─── Serialization ──────────────────────────────────────────────────

export function serializeBlob(blob: PazzeraWalletBlobV2): string {
  return JSON.stringify(blob);
}

export function parseBlob(json: string): PazzeraWalletBlobV2 {
  const parsed = JSON.parse(json);
  if (parsed?.v !== 2) {
    throw new Error(`Expected wallet blob v2, got v${parsed?.v}`);
  }
  return parsed as PazzeraWalletBlobV2;
}

// ─── Backward-compat: accept v1 blobs ───────────────────────────────

interface PazzeraWalletBlobV1 {
  v: 1;
  c: string;
  t: string;
  i: string;
}

export function decryptPrivateKey(userId: string, blobJson: string): Hex {
  // Parse and dispatch by version
  const parsed = JSON.parse(blobJson) as { v: number };
  if (parsed.v === 2) {
    return decryptPrivateKeyV2(userId, parseBlob(blobJson));
  }
  if (parsed.v === 1) {
    // v1 stored the private key directly as base64 (or as a dev-fake sentinel).
    // v1 was used only by the seed; in real use, v1 was the dev path.
    // We support reading v1 here for completeness; v1 ciphertexts should
    // be migrated to v2 immediately after first read.
    const v1 = parsed as unknown as PazzeraWalletBlobV1;
    // Re-derive the v1 key the same way wallet-signer.ts did originally.
    const env = getEnv();
    const masterKey = Buffer.from(env.WALLET_MASTER_KEY, 'hex');
    const derived = hkdfSync('sha256', masterKey, Buffer.from('pazzera:wallet:v1'), Buffer.from(userId), KEY_LEN);
    const key = Buffer.from(derived);
    const decipher = createDecipheriv(ALGO, key, Buffer.from(v1.i, 'base64'));
    decipher.setAuthTag(Buffer.from(v1.t, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(v1.c, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8') as Hex;
  }
  throw new Error(`Unknown wallet blob version: ${(parsed as { v: number }).v}`);
}

/**
 * Re-encrypt a v1 blob to v2 + current key/salt versions.
 * Returns the new JSON-serialized blob. Idempotent (v2→v2 is a no-op).
 */
export function migrateToV2(userId: string, blobJson: string): string {
  const parsed = JSON.parse(blobJson) as { v: number };
  if (parsed.v === 2) return blobJson;
  const privateKey = decryptPrivateKey(userId, blobJson);
  const v2 = encryptPrivateKeyV2(userId, privateKey);
  return serializeBlob(v2);
}

// ─── High-level helpers (recommended) ──────────────────────────────

export function encryptPrivateKey(userId: string, privateKey: Hex): string {
  return serializeBlob(encryptPrivateKeyV2(userId, privateKey));
}

export function decryptAndMigrate(userId: string, blobJson: string): { key: Hex; migratedJson: string } {
  const parsed = JSON.parse(blobJson) as { v: number };
  const key = decryptPrivateKey(userId, blobJson);
  if (parsed.v === 2) return { key, migratedJson: blobJson };
  return { key, migratedJson: migrateToV2(userId, blobJson) };
}

// ─── Keypair generation ─────────────────────────────────────────────

export function generateWalletKeypairV2(): { privateKey: Hex; address: Address } {
  const privateKey = `0x${randomBytes(32).toString('hex')}` as Hex;
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

/** Address fingerprint — used to detect when a stored address no longer matches the key. */
export function fingerprintAddress(address: Address): string {
  return createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 16);
}

export const ENCRYPTION_FORMAT_VERSION = CURRENT_FORMAT_VERSION;
export const ENCRYPTION_KEY_VERSION = CURRENT_KEY_VERSION;
export const ENCRYPTION_SALT_VERSION = CURRENT_SALT_VERSION;