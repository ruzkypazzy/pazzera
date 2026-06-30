/**
 * Username service.
 *
 * Rules (per Phase 3 spec):
 *   - 3–20 characters
 *   - lowercase a–z, digits, underscore
 *   - must not begin or end with underscore
 *   - must not be a reserved word
 *   - uniqueness checked at create-time via DB
 *
 * On first login (no username supplied), we auto-generate a candidate from
 * the email local-part + a short random suffix, then validate against rules
 * and uniqueness. The user can change it from the profile page later
 * (Phase 5 wires the UI).
 */

export const RESERVED_USERNAMES = new Set<string>([
  'admin',
  'support',
  'pazzera',
  'payments',
  'wallet',
  'api',
  'system',
  'root',
  'help',
  'security',
  'auth',
  'login',
  'signup',
  'settings',
  'profile',
  'dashboard',
  'artist',
  'listener',
  'play',
  'stream',
  'song',
  'songs',
  'feed',
  'home',
  'about',
  'terms',
  'privacy',
  'legal',
  'team',
  'staff',
  'mod',
  'moderator',
  'curator',
  'fan',
  'split',
  'discovery',
  'null',
  'undefined',
  'true',
  'false',
  'me',
  'you',
  'official',
  'verified',
  'new',
  'trending',
  'top',
  'best',
  'music',
  'beat',
  'beats',
  'sound',
  'audio',
  'nft',
  'token',
  'airdrop',
]);

const USERNAME_RE = /^[a-z][a-z0-9_]{1,18}[a-z0-9]$/;

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string };

export function validateUsername(input: string): UsernameValidation {
  if (typeof input !== 'string') return { ok: false, reason: 'must be a string' };
  const normalized = input.trim().toLowerCase();
  if (normalized.length < 3) return { ok: false, reason: 'must be at least 3 characters' };
  if (normalized.length > 20) return { ok: false, reason: 'must be 20 characters or fewer' };
  if (!USERNAME_RE.test(normalized)) {
    return {
      ok: false,
      reason: 'only lowercase a–z, digits, and underscore; must start with a letter and end with a letter or digit',
    };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return { ok: false, reason: 'username is reserved' };
  }
  return { ok: true, value: normalized };
}

/**
 * Generate a candidate username from an email + optional preferred.
 * Returns a value that *should* pass validateUsername; uniqueness still
 * has to be checked at the DB level (caller does that).
 */
export function generateUsernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  // Strip everything not [a-z0-9_], lowercase, prefix 'u' if starts with digit
  let base = local.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 14);
  if (base.length === 0) base = 'user';
  if (/^[0-9_]/.test(base)) base = 'u' + base;
  if (base.length < 3) base = (base + 'user').slice(0, 3);
  // Add short random suffix
  const suffix = Math.random().toString(36).slice(2, 6);
  const candidate = `${base.slice(0, Math.max(3, 14 - suffix.length - 1))}_${suffix}`;
  // Truncate to 20 chars max
  return candidate.slice(0, 20);
}

export function isReservedUsername(name: string): boolean {
  return RESERVED_USERNAMES.has(name.toLowerCase());
}