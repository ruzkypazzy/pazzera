/**
 * Audio analysis — extracts BPM, duration, format, and a coarse energy /
 * mood heuristic from an audio file using `music-metadata`.
 *
 * Returns a stable shape the LLM can consume. If anything fails, returns
 * a "low confidence" shape so the agent still proposes a rate.
 */

import { parseBlob } from 'music-metadata';
import { promises as fs } from 'node:fs';

export type AudioAnalysis = {
  /** seconds (rounded to 1 decimal) */
  durationSeconds: number;
  /** BPM if we can detect a strong hint, else null */
  bpm: number | null;
  /** format / container e.g. "MP3", "FLAC", "M4A" */
  format: string;
  /** bitrate kbps if reported */
  bitrateKbps: number | null;
  /** sample rate Hz */
  sampleRateHz: number | null;
  /** channels 1=mono, 2=stereo */
  channels: number;
  /** size in bytes */
  sizeBytes: number;
  /** estimated energy — derived from format/bitrate (proxy) */
  energy: 'low' | 'mid' | 'high';
  /** detected tag metadata (artist / title / genre) */
  tags: {
    title: string | null;
    artist: string | null;
    album: string | null;
    genre: string | null;
    year: number | null;
    comment: string | null;
  };
  /** detected mood label if we can infer one from genre tag */
  moodFromTag: string | null;
  /** "low" if anything went wrong */
  confidence: 'low' | 'mid' | 'high';
};

function inferEnergyFromFormat(format: string, bitrateKbps: number | null): 'low' | 'mid' | 'high' {
  // Crude proxy — bitrate under 128 kbps → low, 128-256 → mid, ≥256 → high
  if (!bitrateKbps) return 'mid';
  if (bitrateKbps < 128) return 'low';
  if (bitrateKbps < 256) return 'mid';
  return 'high';
}

function inferMoodFromTag(genre: string | null): string | null {
  if (!genre) return null;
  const g = genre.toLowerCase();
  if (/(trap|drill|grime|metal|punk)/.test(g)) return 'aggressive';
  if (/(house|techno|edm|trance|dubstep|dance)/.test(g)) return 'energetic';
  if (/(r&b|soul|funk)/.test(g)) return 'soulful';
  if (/(jazz|blues)/.test(g)) return 'mellow';
  if (/(ambient|chill|lo-fi|lofi)/.test(g)) return 'chill';
  if (/(folk|acoustic|country|singer-songwriter)/.test(g)) return 'introspective';
  if (/(pop|indie|alternative)/.test(g)) return 'upbeat';
  if (/(hip-hop|rap)/.test(g)) return 'urban';
  return null;
}

function inferBpmFromFilename(name: string): number | null {
  const m = name.match(/(\d{2,3})\s*bpm/i);
  if (!m) return null;
  const v = Number(m[1]);
  if (v >= 40 && v <= 220) return v;
  return null;
}

export async function analyzeAudio(input: { filePath: string; originalFilename?: string }): Promise<AudioAnalysis> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(input.filePath);
  } catch (err) {
    return {
      durationSeconds: 0,
      bpm: null,
      format: 'UNKNOWN',
      bitrateKbps: null,
      sampleRateHz: null,
      channels: 0,
      sizeBytes: 0,
      energy: 'mid',
      tags: { title: null, artist: null, album: null, genre: null, year: null, comment: null },
      moodFromTag: null,
      confidence: 'low',
    };
  }
  try {
    const meta = await parseBlob(new Blob([buf]));
    const tagTitle = (meta.common.title as string | undefined) ?? null;
    const tagArtist = (meta.common.artist as string | undefined) ?? null;
    const tagAlbum = (meta.common.album as string | undefined) ?? null;
    const tagGenreRaw = meta.common.genre?.[0];
    const tagGenre = (typeof tagGenreRaw === 'string' ? tagGenreRaw : null) ?? null;
    const tagYear = (meta.common.year as number | undefined) ?? null;
    const tagComment = ((meta.common.comment?.[0] as string | undefined) ?? null);
    const format = (meta.format.container ?? 'UNKNOWN').toUpperCase();
    const bitrateKbps = meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null;
    const sampleRateHz = meta.format.sampleRate ?? null;
    const channels = meta.format.numberOfChannels ?? 0;
    const durationSeconds = meta.format.duration ? Math.round(meta.format.duration * 10) / 10 : 0;
    const bpm = inferBpmFromFilename(input.originalFilename ?? '');
    return {
      durationSeconds,
      bpm,
      format,
      bitrateKbps,
      sampleRateHz,
      channels,
      sizeBytes: buf.length,
      energy: inferEnergyFromFormat(format, bitrateKbps),
      tags: {
        title: tagTitle,
        artist: tagArtist,
        album: tagAlbum,
        genre: tagGenre,
        year: tagYear,
        comment: tagComment,
      },
      moodFromTag: inferMoodFromTag(tagGenre),
      confidence: tagTitle || tagArtist || tagGenre ? 'mid' : 'low',
    };
  } catch {
    return {
      durationSeconds: 0,
      bpm: inferBpmFromFilename(input.originalFilename ?? ''),
      format: 'UNKNOWN',
      bitrateKbps: null,
      sampleRateHz: null,
      channels: 0,
      sizeBytes: buf.length,
      energy: 'mid',
      tags: { title: null, artist: null, album: null, genre: null, year: null, comment: null },
      moodFromTag: null,
      confidence: 'low',
    };
  }
}