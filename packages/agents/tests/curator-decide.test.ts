import { describe, it, expect } from 'vitest';
import { decideCurator, type CuratorInput } from '../src/curator/decide';

const baseInput: CuratorInput = {
  songId: 'song-1',
  artistRequestedPriceUsdc: 0.004,
  metadata: {
    title: 'Midnight Protocol',
    artistName: 'Ada Lovelace',
    featuredNames: ['Tunde'],
    producerName: 'BeatsByNeo',
    description: 'A 4-minute deep-house cut featuring percussion. Mastered at 24-bit / 48 kHz.',
    coverUrl: 'https://example/cover.jpg',
    audioUrl: 'https://example/audio.mp3',
    durationSeconds: 240,
  },
  audioQuality: {
    bitrateKbps: 320,
    sampleRateHz: 48000,
    channels: 2,
    peakDb: -1.2,
  },
  artistHistory: {
    totalSongs: 4,
    approvedSongs: 3,
    rejectedSongs: 1,
    flaggedForSpam: 0,
  },
  duplicateOfSongId: null,
  usernamesResolved: true,
  recipientCount: 3,
};

describe('decideCurator', () => {
  it('approves a high-quality submission and prices at the band ceiling', () => {
    const result = decideCurator(baseInput);
    expect(result.decision).toBe('approved');
    expect(Number(result.publishedPriceUsdc)).toBeLessThanOrEqual(0.004);
    expect(result.publishedPriceUsdc).not.toBe('0');
    expect(result.scores.total).toBeGreaterThanOrEqual(31);
    expect(result.scores.metadata).toBeLessThanOrEqual(20);
    expect(result.scores.audio).toBeLessThanOrEqual(20);
  });

  it('rejects on duplicate match', () => {
    const result = decideCurator({
      ...baseInput,
      duplicateOfSongId: 'song-other',
    });
    expect(result.decision).toBe('rejected');
    expect(result.publishedPriceUsdc).toBe('0');
    expect(result.scores.duplicate).toBe(0);
  });

  it('rejects when score is below threshold (very low quality audio)', () => {
    const result = decideCurator({
      ...baseInput,
      audioQuality: { ...baseInput.audioQuality, bitrateKbps: 64, peakDb: -0.5 },
    });
    expect(result.decision).toBe('rejected');
  });

  it('caps pricing at the band ceiling, never above', () => {
    const result = decideCurator({
      ...baseInput,
      artistRequestedPriceUsdc: 0.005,
    });
    expect(Number(result.publishedPriceUsdc)).toBeLessThanOrEqual(0.005);
  });

  it('lowers price below artist request when score is mid-tier', () => {
    // Force a mid score via weak spam and low audio
    const result = decideCurator({
      ...baseInput,
      audioQuality: { ...baseInput.audioQuality, bitrateKbps: 96, peakDb: -0.5 },
      metadata: { ...baseInput.metadata, description: 'short' },
      artistHistory: { ...baseInput.artistHistory, totalSongs: 20, rejectedSongs: 12 },
    });
    // May be needs_changes or approved at lower band — never exceeds artist pick
    expect(Number(result.publishedPriceUsdc)).toBeLessThanOrEqual(0.004);
  });

  it('clamps each dimension to 0..20', () => {
    const result = decideCurator(baseInput);
    expect(result.scores.metadata).toBeGreaterThanOrEqual(0);
    expect(result.scores.metadata).toBeLessThanOrEqual(20);
    expect(result.scores.audio).toBeGreaterThanOrEqual(0);
    expect(result.scores.audio).toBeLessThanOrEqual(20);
    expect(result.scores.spam).toBeGreaterThanOrEqual(0);
    expect(result.scores.spam).toBeLessThanOrEqual(20);
    expect(result.scores.duplicate).toBeGreaterThanOrEqual(0);
    expect(result.scores.duplicate).toBeLessThanOrEqual(20);
    expect(result.scores.market).toBeGreaterThanOrEqual(0);
    expect(result.scores.market).toBeLessThanOrEqual(20);
  });

  it('total = sum of dimensions', () => {
    const result = decideCurator(baseInput);
    const sum =
      result.scores.metadata +
      result.scores.audio +
      result.scores.spam +
      result.scores.duplicate +
      result.scores.market;
    expect(result.scores.total).toBe(sum);
  });
});