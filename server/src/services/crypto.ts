/**
 * AES-256-GCM encryption for sensitive at-rest secrets (Circle user tokens,
 * 2FA TOTP secrets, password reset tokens).
 *
 * Key derivation: takes ENCRYPTION_KEY env var (any length string) and
 * derives a 32-byte key via SHA-256. Production deployments should set
 * this to a 64-char hex string generated with `openssl rand -hex 32`.
 *
 * If ENCRYPTION_KEY is unset, falls back to JWT_SECRET-derived key. This is
 * NOT cryptographically ideal but lets the dev server start without env config.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;        // GCM standard
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-only-fallback-key';
  return createHash('sha256').update(raw).digest();
}

export function encryptString(plaintext: string): string {
  if (!plaintext) return '';
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv) . base64(tag) . base64(ciphertext)
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptString(payload: string): string {
  if (!payload) return '';
  try {
    const [ivB64, tagB64, encB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !encB64) return '';
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const enc = Buffer.from(encB64, 'base64');
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[crypto] decrypt failed:', e);
    return '';
  }
}

/**
 * Hash a one-time token for at-rest storage (password resets, email verify).
 * We hash (not encrypt) so even DB compromise can't reuse the token.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}