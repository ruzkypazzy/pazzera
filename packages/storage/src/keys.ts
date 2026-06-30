/**
 * Storage key prefixes.
 *
 * All objects in R2 (or local) live under one of these namespaces.
 * Never expose the raw key to the client — the public URL is built by
 * the storage service via `R2_PUBLIC_BASE_URL + key`.
 *
 *   songs/audio/        — original full-quality audio
 *   songs/previews/     — 30s compressed clips for discovery
 *   songs/waveforms/    — JSON peaks for the player
 *   songs/covers/       — original cover + thumbnails
 *
 * Each prefix follows `{prefix}/{songId}/{variant}.{ext}` so a single
 * song owns all its derived objects under one folder. This makes
 * R2 lifecycle policies trivial: drop the folder to delete a song.
 */
import { randomUUID } from 'node:crypto';

export const STORAGE_PREFIXES = {
  audio: 'songs/audio',
  preview: 'songs/previews',
  waveform: 'songs/waveforms',
  cover: 'songs/covers',
  coverThumb: 'songs/covers/thumbs',
  coverMedium: 'songs/covers/medium',
  misc: 'songs/misc',
} as const;

export type StoragePrefix = (typeof STORAGE_PREFIXES)[keyof typeof STORAGE_PREFIXES];

/** Generate a key for the original full-quality audio upload. */
export function makeAudioKey(songId: string, ext: string): string {
  return `${STORAGE_PREFIXES.audio}/${songId}/original.${normalizeExt(ext)}`;
}

/** Generate a key for the generated 30s preview clip. */
export function makePreviewKey(songId: string, ext = 'mp3'): string {
  return `${STORAGE_PREFIXES.preview}/${songId}/preview-30s.${normalizeExt(ext)}`;
}

/** Generate a key for the waveform peaks JSON. */
export function makeWaveformKey(songId: string): string {
  return `${STORAGE_PREFIXES.waveform}/${songId}/peaks.json`;
}

/** Generate a key for the original cover image. */
export function makeCoverKey(songId: string, ext: string): string {
  return `${STORAGE_PREFIXES.cover}/${songId}/original.${normalizeExt(ext)}`;
}

/** Generate a key for a cover variant (thumb/medium). */
export function makeCoverVariantKey(
  songId: string,
  variant: 'thumb' | 'medium',
  ext = 'webp',
): string {
  const base = variant === 'thumb' ? STORAGE_PREFIXES.coverThumb : STORAGE_PREFIXES.coverMedium;
  return `${base}/${songId}/${variant}.${normalizeExt(ext)}`;
}

/** Generate a key for an arbitrary misc artifact (e.g. nsfw check output). */
export function makeMiscKey(prefix: string, ext = 'json'): string {
  return `${STORAGE_PREFIXES.misc}/${prefix}/${randomUUID()}.${normalizeExt(ext)}`;
}

function normalizeExt(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!e) return 'bin';
  return e;
}

/**
 * Extract the songId from any of the keys generated above.
 * Returns null if the key is malformed.
 */
export function songIdFromKey(key: string): string | null {
  // Format: songs/{prefix}/{songId}/file
  const m = key.match(/^songs\/(?:audio|previews|waveforms|covers|covers\/thumbs|covers\/medium|misc)\/([^/]+)\//);
  return m && m[1] && !m[1].startsWith('misc') ? m[1] : null;
}