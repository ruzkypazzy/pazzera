/**
 * Password / OTP hashing — Argon2id via hash-wasm.
 *
 * We use Argon2id (the recommended variant), with parameters tuned for OTP
 * verification latency (~50–150ms per check on a modern CPU).
 *
 * Why hash-wasm (not @node-rs/argon2 or argon2):
 *   - Pure WASM — no native bindings, no glibc version pain on Contabo
 *   - Same algorithm as the native packages (Argon2id)
 *   - Works in Workers, Edge, browsers
 *   - One small dependency
 *
 * Encoded format: $argon2id$v=19$m=<KiB>,t=<iters>,p=<lanes>$<salt-b64>$<hash-b64>
 * — identical to the canonical PHC string, parseable by standard tools.
 */
import { argon2id, argon2Verify } from 'hash-wasm';

const PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 19456, // 19 MiB
  hashLength: 32,
  outputType: 'encoded' as const,
};

/** Hash a plaintext secret (OTP code). Returns the encoded PHC string. */
export async function hashOtp(plaintext: string): Promise<string> {
  return argon2id({
    ...PARAMS,
    password: plaintext,
    salt: randomSalt(),
  });
}

/**
 * Constant-time verify of a plaintext secret against a PHC-encoded hash.
 *
 * Implementation-level name — the user-facing flow is `verifyOtp` in
 * `./services/otp-service.ts`, which handles lookup + replay protection
 * before calling this primitive.
 */
export async function verifyOtpHash(plaintext: string, encoded: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: plaintext, hash: encoded });
  } catch {
    return false;
  }
}

function randomSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}