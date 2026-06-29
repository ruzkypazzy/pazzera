/**
 * Curator Agent — pure decision function.
 *
 * Given a candidate song with metadata + audio stats, returns approve /
 * reject / needs_changes plus an adjusted price and reasoning. No DB,
 * no HTTP — fully unit-testable.
 */
import type { CuratorDecision } from '@pazzera/core';

export interface CuratorInput {
  songId: string;
  artistRequestedPriceUsdc: number;
  metadata: {
    title: string;
    artistName: string;
    featuredNames: string[];
    producerName: string | null;
    description: string | null;
    coverUrl: string;
    audioUrl: string;
    durationSeconds: number;
  };
  audioQuality: {
    bitrateKbps: number;
    sampleRateHz: number;
    channels: number;
    peakDb: number | null;
  };
  artistHistory: {
    totalSongs: number;
    approvedSongs: number;
    rejectedSongs: number;
    flaggedForSpam: number;
  };
  // Pre-computed duplicate check
  duplicateOfSongId: string | null;
  // Pre-computed username resolution (did the artist's claimed username exist?)
  usernamesResolved: boolean;
}

const MIN_PRICE = 0.001;
const MAX_PRICE = 0.005;

function clampPrice(p: number, min: number, max: number): number {
  return Math.min(Math.max(p, min), max);
}

export function decideCurator(input: CuratorInput): CuratorDecision {
  const reasons: string[] = [];
  let metadataScore = 0;
  let audioQualityScore = 0;
  let spamScore = 0;

  // ─── Metadata completeness ──────────────────────────────────────
  if (input.metadata.title.length >= 3) metadataScore += 0.15;
  if (input.metadata.artistName.length >= 2) metadataScore += 0.15;
  if (input.metadata.featuredNames.length > 0) metadataScore += 0.1;
  if (input.metadata.producerName) metadataScore += 0.1;
  if (input.metadata.description && input.metadata.description.length >= 30) metadataScore += 0.2;
  if (input.usernamesResolved) metadataScore += 0.2;
  if (input.metadata.coverUrl) metadataScore += 0.1;

  // ─── Audio quality ──────────────────────────────────────────────
  if (input.audioQuality.bitrateKbps >= 256) audioQualityScore += 0.5;
  else if (input.audioQuality.bitrateKbps >= 128) audioQualityScore += 0.3;
  else audioQualityScore += 0.1;

  if (input.audioQuality.sampleRateHz >= 44100) audioQualityScore += 0.2;
  if (input.audioQuality.channels >= 1) audioQualityScore += 0.1;
  if (input.audioQuality.peakDb !== null && input.audioQuality.peakDb > -3) {
    // Hot signal — likely clipped
    audioQualityScore -= 0.2;
    reasons.push('Audio peaks above -3dBFS (possible clipping)');
  }

  // ─── Spam heuristics ────────────────────────────────────────────
  if (input.artistHistory.flaggedForSpam / Math.max(1, input.artistHistory.totalSongs) > 0.3) {
    spamScore += 0.6;
    reasons.push('Artist has high spam history');
  }
  if (input.artistHistory.totalSongs > 0 &&
      input.artistHistory.rejectedSongs / input.artistHistory.totalSongs > 0.5) {
    spamScore += 0.3;
    reasons.push('Artist has high rejection rate');
  }
  if (input.metadata.description &&
      /(https?:\/\/|free money|click here|whatsapp|telegram me)/i.test(input.metadata.description)) {
    spamScore += 0.5;
    reasons.push('Description contains links or spam markers');
  }
  if (input.metadata.title.length > 100) {
    spamScore += 0.2;
    reasons.push('Title suspiciously long');
  }
  // Duplicate
  if (input.duplicateOfSongId) {
    spamScore = 1;
    reasons.push(`Duplicate of existing song ${input.duplicateOfSongId}`);
  }
  // Duration bounds
  if (input.metadata.durationSeconds < 15) {
    spamScore += 0.3;
    reasons.push('Track too short (<15s)');
  }
  if (input.metadata.durationSeconds > 60 * 30) {
    spamScore += 0.2;
    reasons.push('Track very long (>30min) — likely an album rip');
  }

  spamScore = Math.min(spamScore, 1);
  audioQualityScore = Math.max(0, Math.min(audioQualityScore, 1));
  metadataScore = Math.max(0, Math.min(metadataScore, 1));

  // ─── Decision ──────────────────────────────────────────────────
  if (spamScore > 0.7) {
    return {
      decision: 'rejected',
      publishedPriceUsdc: '0',
      reasons,
      metadata: { metadataScore, audioQualityScore, spamScore, duplicateOfSongId: input.duplicateOfSongId },
    };
  }
  if (audioQualityScore < 0.3) {
    return {
      decision: 'rejected',
      publishedPriceUsdc: '0',
      reasons: [...reasons, 'Audio quality below minimum threshold (128 kbps)'],
      metadata: { metadataScore, audioQualityScore, spamScore, duplicateOfSongId: input.duplicateOfSongId },
    };
  }
  if (metadataScore < 0.5) {
    return {
      decision: 'needs_changes',
      publishedPriceUsdc: '0',
      reasons: [...reasons, 'Incomplete metadata — please fill out all fields'],
      metadata: { metadataScore, audioQualityScore, spamScore, duplicateOfSongId: input.duplicateOfSongId },
    };
  }

  // ─── Pricing ────────────────────────────────────────────────────
  // Curator may lower the price if metadata/quality are weak.
  const requested = clampPrice(input.artistRequestedPriceUsdc, MIN_PRICE, MAX_PRICE);
  let factor = 1;
  if (metadataScore < 0.7) factor -= 0.2;
  if (audioQualityScore < 0.6) factor -= 0.2;
  if (spamScore > 0.3) factor -= 0.2;
  const published = clampPrice(
    Number((requested * factor).toFixed(6)),
    MIN_PRICE,
    MAX_PRICE,
  );

  return {
    decision: 'approved',
    publishedPriceUsdc: published.toString(),
    reasons:
      published < requested
        ? [...reasons, `Price lowered from ${requested} to ${published} USDC due to metadata/quality concerns`]
        : reasons,
    metadata: { metadataScore, audioQualityScore, spamScore, duplicateOfSongId: input.duplicateOfSongId },
  };
}