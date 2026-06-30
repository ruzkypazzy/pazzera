/**
 * File validation for upload intake.
 *
 * Rules:
 *   Audio:
 *     - mime: audio/mpeg, audio/wav, audio/x-wav, audio/mp4, audio/x-m4a, audio/flac, audio/x-flac
 *     - ext:  mp3, wav, m4a, flac
 *     - size: ≤ 100 MB
 *   Image (cover):
 *     - mime: image/jpeg, image/png, image/webp
 *     - ext:  jpg, jpeg, png, webp
 *     - size: ≤ 10 MB
 *     - min resolution: 500×500, recommended 1:1
 *
 * Filename sanitization strips path components, control chars, and
 * caps length. We never trust the client extension alone — a proper
 * MIME sniff happens during finalize (server-side ffprobe / file-type).
 */

export const AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/x-m4a',
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
]);

export const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'flac']);
export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export const AUDIO_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const MIN_COVER_DIM = 500;

export type ValidationResult =
  | { ok: true; mime: string; ext: string; sanitizedFilename: string }
  | { ok: false; reason: string };

export function validateAudio(filename: string, mime: string, size: number): ValidationResult {
  const safe = sanitizeFilename(filename);
  const ext = extensionOf(safe);
  if (!ext || !AUDIO_EXT.has(ext)) {
    return { ok: false, reason: `Audio extension must be one of: ${[...AUDIO_EXT].join(', ')}` };
  }
  if (!mime || !AUDIO_MIME.has(mime)) {
    return { ok: false, reason: 'Audio MIME type is missing or unsupported' };
  }
  if (size > AUDIO_MAX_BYTES) {
    return { ok: false, reason: `Audio file too large: ${(size / 1024 / 1024).toFixed(1)} MB (max 100 MB)` };
  }
  if (size <= 0) {
    return { ok: false, reason: 'Audio file is empty' };
  }
  return { ok: true, mime, ext, sanitizedFilename: safe };
}

export function validateImage(filename: string, mime: string, size: number): ValidationResult {
  const safe = sanitizeFilename(filename);
  const ext = extensionOf(safe);
  if (!ext || !IMAGE_EXT.has(ext)) {
    return { ok: false, reason: `Image extension must be one of: ${[...IMAGE_EXT].join(', ')}` };
  }
  if (!mime || !IMAGE_MIME.has(mime)) {
    return { ok: false, reason: 'Image MIME type is missing or unsupported' };
  }
  if (size > IMAGE_MAX_BYTES) {
    return { ok: false, reason: `Image too large: ${(size / 1024 / 1024).toFixed(1)} MB (max 10 MB)` };
  }
  if (size <= 0) {
    return { ok: false, reason: 'Image file is empty' };
  }
  return { ok: true, mime, ext, sanitizedFilename: safe };
}

/**
 * Sanitize a user-supplied filename: strip path components, control chars,
 * unicode shenanigans, and cap length. Returns a safe ASCII-ish name.
 */
export function sanitizeFilename(input: string): string {
  if (!input) return 'file';
  // Strip directory components
  const base = input.split(/[\\/]/).pop() ?? 'file';
  // Reject control chars and NULs
  let cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '');
  // Replace suspicious unicode (zero-width, RTL override)
  cleaned = cleaned.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
  // Allow only [A-Za-z0-9._-]
  cleaned = cleaned.replace(/[^A-Za-z0-9._-]/g, '_');
  // Trim leading dots/dashes (no hidden files, no flag-like names)
  cleaned = cleaned.replace(/^[._-]+/, '');
  // Cap length
  if (cleaned.length > 120) cleaned = cleaned.slice(0, 120);
  if (!cleaned) cleaned = 'file';
  return cleaned;
}

function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1]!.toLowerCase() : '';
}

/**
 * Server-side MIME sniff using magic bytes.
 * Returns the sniffed MIME if it differs from the client-claimed one,
 * or null if they match. Used to reject spoofed uploads.
 */
export function sniffMimeMismatch(
  sniffed: string | null,
  claimed: string,
): { ok: true } | { ok: false; reason: string } {
  if (!sniffed) return { ok: true };
  if (sniffed === claimed) return { ok: true };
  // Allow some well-known equivalents
  const equivalents: Record<string, string[]> = {
    'audio/mpeg': ['audio/mp3'],
    'audio/mp3': ['audio/mpeg'],
    'audio/wav': ['audio/wave', 'audio/x-wav'],
    'audio/wave': ['audio/wav', 'audio/x-wav'],
    'audio/x-wav': ['audio/wav', 'audio/wave'],
    'audio/x-m4a': ['audio/m4a', 'audio/mp4'],
    'audio/m4a': ['audio/x-m4a', 'audio/mp4'],
    'audio/mp4': ['audio/x-m4a', 'audio/m4a'],
    'audio/flac': ['audio/x-flac'],
    'audio/x-flac': ['audio/flac'],
    'image/jpeg': ['image/jpg'],
    'image/jpg': ['image/jpeg'],
  };
  const allowed = equivalents[sniffed] ?? [];
  if (allowed.includes(claimed)) return { ok: true };
  return {
    ok: false,
    reason: `MIME mismatch: client said ${claimed}, file content is ${sniffed}`,
  };
}