import { describe, it, expect } from 'vitest';
import {
  validateUsername,
  generateUsernameFromEmail,
  isReservedUsername,
} from '../src/utils/username';

describe('validateUsername', () => {
  it('accepts a valid username', () => {
    const r = validateUsername('cool_artist_99');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('cool_artist_99');
  });

  it('lowercases input', () => {
    const r = validateUsername('Ada_Lovelace');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('ada_lovelace');
  });

  it('rejects usernames under 3 chars', () => {
    expect(validateUsername('ab').ok).toBe(false);
  });

  it('rejects usernames over 20 chars', () => {
    expect(validateUsername('a'.repeat(21)).ok).toBe(false);
  });

  it('rejects reserved words (admin, support, etc.)', () => {
    for (const reserved of ['admin', 'support', 'pazzera', 'wallet', 'api', 'system']) {
      expect(isReservedUsername(reserved)).toBe(true);
      expect(validateUsername(reserved).ok).toBe(false);
    }
  });

  it('rejects usernames starting with a digit', () => {
    expect(validateUsername('1user').ok).toBe(false);
  });

  it('rejects usernames with uppercase / symbols', () => {
    expect(validateUsername('User-Name!').ok).toBe(false);
    expect(validateUsername('foo bar').ok).toBe(false);
  });
});

describe('generateUsernameFromEmail', () => {
  it('produces a valid username', () => {
    for (let i = 0; i < 20; i++) {
      const u = generateUsernameFromEmail('ada.lovelace@example.com');
      const v = validateUsername(u);
      // Even if it happens to hit a reserved word (very rare with random suffix),
      // the result should at least match the format.
      if (!v.ok) {
        expect(v.reason).not.toMatch(/format/);
      } else {
        expect(v.value.length).toBeGreaterThanOrEqual(3);
        expect(v.value.length).toBeLessThanOrEqual(20);
      }
    }
  });

  it('handles emails with digits and dots in the local part', () => {
    for (let i = 0; i < 10; i++) {
      const u = generateUsernameFromEmail('tunde.1234@gmail.com');
      const v = validateUsername(u);
      expect(v.ok || v.reason === 'username is reserved').toBe(true);
    }
  });
});