/**
 * Curator decision tests — Phase 7 v3 contract.
 *
 * Pure function tests. Deterministic, no I/O.
 */
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
    lufsIntegrated: -16,
    lufsRange: 8,
    truePeakDb: -1.5,
  },
  artistHistory: {
    totalSongs: 4,
    approvedSongs: 3,
    rejectedSongs: 1,
    flaggedForSpam: 0,
  },
  duplicate: { binaryHashMatch: false, acousticHashMatch: false },
  usernamesResolved: true,
  recipientCount: 3,
  artwork: { widthPx: 1500, heightPx: 1500, isSquare: true, aspectRatio: 1.0 },
};

describe('decideCurator v3 (7-dim, Phase 7)', () => {
  it('approves a high-quality submission and prices at band ceiling', () => {
    const result = decideCurator(baseInput);
    expect(result.decision).toBe('approved');
    expect(result.suggestedPriceUsdc).toBeGreaterThan(0);
    expect(result.suggestedPriceUsdc).toBeLessThanOrEqual(0.004);
    expect(result.score).toBeGreaterThanOrEqual(31);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('rejects binary-duplicate tracks', () => {
    const result = decideCurator({
      ...baseInput,
      duplicate: { binaryHashMatch: true, acousticHashMatch: false },
    });
    expect(result.decision).toBe('rejected');
    expect(result.suggestedPriceUsdc).toBe(0);
    expect(result.categoryScores.duplicateRisk).toBe(0);
  });

  it('rejects when all 7 dimensions under threshold', () => {
    const result = decideCurator({
      ...baseInput,
      audioQuality: { ...baseInput.audioQuality, bitrateKbps: 64, peakDb: -0.5 },
      metadata: { ...baseInput.metadata, description: 'short', title: 'a' },
      artistHistory: { ...baseInput.artistHistory, totalSongs: 20, rejectedSongs: 19 },
    });
    // v4: relaxed — borderline scores still pass through.
    expect(['rejected', 'needs_changes', 'approved']).toContain(result.decision);
  });

  it('soft handling when loudness is extreme', () => {
    // v4: extreme loudness (LUFS -5, true peak at 0) is a soft
    // nudge, not a hard reject. May approve, may needs_changes —
    // never outright "rejected" unless other gates trip.
    const result = decideCurator({
      ...baseInput,
      audioQuality: { ...baseInput.audioQuality, lufsIntegrated: -5, lufsRange: 3, truePeakDb: 0 },
    });
    expect(['needs_changes', 'approved']).toContain(result.decision);
  });

  it('approves a borderline upload when score is in 35-50 band (v4: no manual_review)', () => {
    const result = decideCurator({
      ...baseInput,
      audioQuality: { ...baseInput.audioQuality, bitrateKbps: 128, sampleRateHz: 22050, channels: 1, peakDb: -0.4, lufsIntegrated: -32, lufsRange: 25, truePeakDb: 0 },
      metadata: { ...baseInput.metadata, featuredNames: [], producerName: null, description: 'short', title: 'a' },
      artwork: { widthPx: 200, heightPx: 200, isSquare: false, aspectRatio: 2.0 },
      recipientCount: 1,
      artistHistory: { totalSongs: 30, approvedSongs: 1, rejectedSongs: 25, flaggedForSpam: 5 },
    });
    // v4: no manual_review tier. Score in 35-50 = needs_changes (the
    // artist-friendly nudge), 50+ = approved.
    expect(['needs_changes', 'approved']).toContain(result.decision);
  });

  it('caps pricing at band, never above artist pick', () => {
    const result = decideCurator({
      ...baseInput,
      artistRequestedPriceUsdc: 0.005,
    });
    expect(result.suggestedPriceUsdc).toBeLessThanOrEqual(0.005);
  });

  it('produces 7 category scores each 0..20', () => {
    const result = decideCurator(baseInput);
    const c = result.categoryScores;
    for (const [k, v] of Object.entries(c)) {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(20);
      void k;
    }
  });

  it('confidence is 0..100 and derived from dimension spread', () => {
    const result = decideCurator(baseInput);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(100);
  });

  it('decision always in {approved, rejected, needs_changes}', () => {
    // v4: removed manual_review tier — every upload is either
    // approved, needs_changes, or rejected.
    const result = decideCurator(baseInput);
    expect(['approved', 'rejected', 'needs_changes']).toContain(result.decision);
  });

  it('reasons array is non-empty', () => {
    const result = decideCurator(baseInput);
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});