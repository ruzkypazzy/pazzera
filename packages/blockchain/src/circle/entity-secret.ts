/**
 * Entity Secret encryption for Circle Developer-Controlled Wallets.
 *
 * Per Circle W3S docs:
 *   - Acquire the public key via  GET /v1/w3s/config/entity/publicKey
 *   - The entity secret is a 32-byte hex string (the user stores it in
 *     CIRCLE_ENTITY_SECRET)
 *   - For every write API call (create wallet, create transfer, sign),
 *     the secret must be encrypted with that public key using
 *     RSA-OAEP (SHA-256, MGF1-SHA-256) and base64-encoded.
 *   - Each ciphertext is single-use. Reusing one is rejected as a
 *     replay attack.
 *
 * Refs:
 *   https://developers.circle.com/wallets/dev-controlled/entity-secret-management
 *   https://github.com/circlefin/w3s-entity-secret-sample-code
 */
import forge from 'node-forge';
import { logger } from '@pazzera/core';

let cachedPublicKeyPem: string | null = null;
let cachedFetchedAt = 0;
const PUBLIC_KEY_TTL_MS = 60 * 60 * 1000; // 1h; rotate daily in production

interface FetchOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** Pull Circle's RSA public key (one per process, with TTL). */
export async function getEntityPublicKey(
  opts: FetchOptions,
): Promise<string> {
  const now = Date.now();
  if (cachedPublicKeyPem && now - cachedFetchedAt < PUBLIC_KEY_TTL_MS) {
    return cachedPublicKeyPem;
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, '')}/v1/w3s/config/entity/publicKey`;
  const r = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(
      `Circle public-key fetch failed: ${r.status} ${r.statusText} ${body.slice(0, 200)}`,
    );
  }
  const json = (await r.json()) as { data?: { publicKey?: string }; publicKey?: string };
  const pem = json.data?.publicKey ?? json.publicKey;
  if (!pem || !pem.includes('BEGIN PUBLIC KEY')) {
    throw new Error('Circle public-key response missing PEM');
  }
  cachedPublicKeyPem = pem;
  cachedFetchedAt = now;
  logger.info({ source: 'circle' }, 'entity-secret:public-key-cached');
  return pem;
}

/** Clear cache (used by tests). */
export function __resetEntityPublicKeyCacheForTests(): void {
  cachedPublicKeyPem = null;
  cachedFetchedAt = 0;
}

/**
 * Encrypt the hex entity secret under the given PEM public key using
 * RSA-OAEP / SHA-256 / MGF1-SHA-256, base64-encode the result.
 * Returns a fresh ciphertext per call.
 */
export function encryptEntitySecret(publicKeyPem: string, hexSecret: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(hexSecret)) {
    throw new Error('CIRCLE_ENTITY_SECRET must be a 64-char hex string (32 bytes)');
  }
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  const bytes = forge.util.hexToBytes(hexSecret);
  // node-forge's RSA-OAEP mode is RSA-OAEP, with sha-256 for the
  // encryption hash and sha-256 for MGF1. That matches Circle's
  // documented RSAES-OAEP defaults.
  const encrypted = publicKey.encrypt(bytes, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() },
  });
  return forge.util.encode64(encrypted);
}