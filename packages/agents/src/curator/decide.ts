/**
 * Curator Agent — pure decision function.
 *
 * Scoring model (5 dimensions × 20 points = 100 total):
 *
 *   metadataScore      (0–20)  — completeness of artist-submitted fields
 *   audioScore         (0–20)  — bitrate, sample rate, clipping, silence
 *   spamScore          (0–20)  — inverted; 20 = clearly legitimate
 *   duplicateScore     (0–20)  — inverted; 20 = clearly unique
 *   marketScore        (0–20)  — engagement prediction (artist history, tag rarity)
 *
 * Pricing bands (after totalScore computed):
 *
 *   totalScore <  31  → reject
 *   31 ≤ x <  51      → 0.001 USDC
 *   51 ≤ x <  71      → 0.002 USDC
 *   71 ≤ x <  86      → 0.003 USDC
 *   86 ≤ x <  96      → 0.004 USDC
 *   96 ≤ x ≤ 100      → 0.005 USDC
 *
 * The artist may request a higher price; the curator's published price
 * is the LOWER of (artist-requested, band-derived). Artist's pick is
 * a ceiling, never exceeded.
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
    /** Optional silence ratio 0–1 from pre-processing. */
    silenceRatio?: number | null;
  };
  artistHistory: {
    totalSongs: number;
    approvedSongs: number;
    rejectedSongs: number;
    flaggedForSpam: number;
  };
  duplicateOfSongId: string | null;
  usernamesResolved: boolean;
  // Existing recipients count from the song (helps judge market fit)
  recipientCount: number;
}

export interface CuratorScore {
  metadata: number;     // 0–20
  audio: number;        // 0–20
  spam: number;         // 0–20 (higher = better)
  duplicate: number;    // 0–20 (higher = better)
  market: number;       // 0–20
  total: number;        // 0–100
}

export interface CuratorDecisionV2 {
  decision: 'approved' | 'rejected' | 'needs_changes' | 'suspended';
  publishedPriceUsdc: string; // "0" if rejected
  priceBand: string;          // e.g. "0.002", "rejected"
  scores: CuratorScore;
  reasons: string[];
}

const REJECT_THRESHOLD = 31;
const PRICE_BANDS: Array<{ min: number; max: number; price: number }> = [
  { min: 96, max: 101, price: 0.005 },
  { min: 86, max: 96, price: 0.004 },
  { min: 71, max: 86, price: 0.003 },
  { min: 51, max: 71, price: 0.002 },
  { min: 31, max: 51, price: 0.001 },
];

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function priceForTotal(total: number): { price: number; band: string } {
  const band = PRICE_BANDS.find((b) => total >= b.min && total < b.max);
  return band
    ? { price: band.price, band: band.price.toFixed(3) }
    : { price: 0, band: 'rejected' };
}

export function decideCurator(input: CuratorInput): CuratorDecisionV2 {
  const reasons: string[] = [];

  // ─── Metadata score (0–20) ──────────────────────────────────────
  let metadata = 0;
  if (input.metadata.title.length >= 3 && input.metadata.title.length <= 80) metadata += 4;
  else if (input.metadata.title.length > 80) {
    metadata += 1;
    reasons.push('Title unusually long');
  }
  if (input.metadata.artistName.length >= 2) metadata += 3;
  if (input.metadata.featuredNames.length > 0) metadata += 2;
  if (input.metadata.producerName) metadata += 2;
  if (input.metadata.description && input.metadata.description.length >= 60) metadata += 3;
  else if (input.metadata.description && input.metadata.description.length >= 20) metadata += 1;
  else reasons.push('Description too short (<60 chars recommended)');
  if (input.usernamesResolved) metadata += 4;
  else reasons.push('One or more Pazzera usernames could not be resolved');
  if (input.metadata.coverUrl) metadata += 2;

  // ─── Audio score (0–20) ────────────────────────────────────────
  let audio = 0;
  if (input.audioQuality.bitrateKbps >= 320) audio += 8;
  else if (input.audioQuality.bitrateKbps >= 256) audio += 6;
  else if (input.audioQuality.bitrateKbps >= 192) audio += 4;
  else if (input.audioQuality.bitrateKbps >= 128) audio += 2;
  else {
    audio += 0;
    reasons.push('Audio bitrate below 128 kbps minimum');
  }

  if (input.audioQuality.sampleRateHz >= 44100) audio += 4;
  else if (input.audioQuality.sampleRateHz >= 22050) audio += 2;

  if (input.audioQuality.channels >= 2) audio += 2;
  else audio += 1;

  if (input.audioQuality.peakDb !== null && input.audioQuality.peakDb > -1) {
    audio -= 4;
    reasons.push('Audio clips heavily (peak > -1 dBFS)');
  } else if (input.audioQuality.peakDb !== null && input.audioQuality.peakDb > -3) {
    audio -= 2;
    reasons.push('Audio peaks above -3 dBFS (possible clipping)');
  } else {
    audio += 2;
  }

  if (input.audioQuality.silenceRatio !== null && input.audioQuality.silenceRatio !== undefined) {
    if (input.audioQuality.silenceRatio > 0.5) {
      audio -= 4;
      reasons.push('Excessive silence (>50% of duration)');
    } else if (input.audioQuality.silenceRatio > 0.3) {
      audio -= 2;
    } else {
      audio += 4;
    }
  }

  // ─── Spam score (0–20, higher = better) ────────────────────────
  let spam = 20; // start at perfect
  if (input.artistHistory.flaggedForSpam > 0) {
    spam -= Math.min(8, input.artistHistory.flaggedForSpam * 2);
    reasons.push(`Artist has ${input.artistHistory.flaggedForSpam} prior spam flags`);
  }
  if (
    input.artistHistory.totalSongs > 0 &&
    input.artistHistory.rejectedSongs / input.artistHistory.totalSongs > 0.5
  ) {
    spam -= 5;
    reasons.push('Artist rejection rate > 50%');
  }
  if (
    input.metadata.description &&
    /(https?:\/\/|free money|click here|whatsapp|telegram me|buy now|dm me)/i.test(
      input.metadata.description,
    )
  ) {
    spam -= 12;
    reasons.push('Description contains spam markers (links, "dm me", etc.)');
  }
  if (input.metadata.title.length > 100) {
    spam -= 4;
    reasons.push('Title suspiciously long');
  }
  if (input.metadata.durationSeconds < 15) {
    spam -= 4;
    reasons.push('Track under 15s — likely a sample, not a song');
  }
  if (input.metadata.durationSeconds > 60 * 30) {
    spam -= 3;
    reasons.push('Track over 30min — likely an album rip or unedited recording');
  }
  if (input.metadata.featuredNames.length > 10) {
    spam -= 4;
    reasons.push('More than 10 featured artists — likely abuse');
  }

  // ─── Duplicate score (0–20, higher = better) ──────────────────
  let duplicate = 20;
  if (input.duplicateOfSongId) {
    duplicate = 0;
    reasons.push(`Audio fingerprint matches existing song ${input.duplicateOfSongId}`);
  }

  // ─── Market score (0–20) ───────────────────────────────────────
  let market = 10; // neutral baseline
  // Engagement history proxy
  if (input.artistHistory.totalSongs >= 5) market += 2;
  if (input.artistHistory.approvedSongs >= 3) market += 2;
  if (input.artistHistory.approvedSongs / Math.max(1, input.artistHistory.totalSongs) > 0.8) {
    market += 2;
  }
  // Multiple recipients → coordinated release → higher market fit
  if (input.recipientCount >= 3) market += 2;
  else if (input.recipientCount === 1) market -= 2;
  // Sweet-spot duration (2–6 min) → higher predicted engagement
  if (
    input.metadata.durationSeconds >= 120 &&
    input.metadata.durationSeconds <= 360
  ) {
    market += 2;
  } else if (input.metadata.durationSeconds < 60 || input.metadata.durationSeconds > 600) {
    market -= 1;
  }

  // ─── Clamp + total ─────────────────────────────────────────────
  const scores: CuratorScore = {
    metadata: clampInt(metadata, 0, 20),
    audio: clampInt(audio, 0, 20),
    spam: clampInt(spam, 0, 20),
    duplicate: clampInt(duplicate, 0, 20),
    market: clampInt(market, 0, 20),
    total: 0,
  };
  scores.total =
    scores.metadata + scores.audio + scores.spam + scores.duplicate + scores.market;

  // ─── Decision ──────────────────────────────────────────────────
  if (scores.total < REJECT_THRESHOLD) {
    return {
      decision: 'rejected',
      publishedPriceUsdc: '0',
      priceBand: 'rejected',
      scores,
      reasons: reasons.length ? reasons : ['Total score below acceptance threshold'],
    };
  }
  // Hard fails: duplicate + spam floor
  if (scores.duplicate === 0) {
    return {
      decision: 'rejected',
      publishedPriceUsdc: '0',
      priceBand: 'rejected',
      scores,
      reasons,
    };
  }
  if (scores.spam < 6) {
    return {
      decision: 'rejected',
      publishedPriceUsdc: '0',
      priceBand: 'rejected',
      scores,
      reasons,
    };
  }
  // Audio floor (any signal of broken audio → needs_changes)
  if (scores.audio < 6) {
    return {
      decision: 'needs_changes',
      publishedPriceUsdc: '0',
      priceBand: 'needs_changes',
      scores,
      reasons,
    };
  }

  // ─── Pricing ──────────────────────────────────────────────────
  const { price: bandPrice, band } = priceForTotal(scores.total);
  // Curator never exceeds the artist's pick
  const requested = Math.max(0.001, Math.min(0.005, input.artistRequestedPriceUsdc));
  const published = Math.min(requested, bandPrice);

  if (published < requested) {
    reasons.push(
      `Price lowered from ${requested} to ${published.toFixed(3)} USDC — score ${scores.total}/100 maps to band ${band}`,
    );
  }

  return {
    decision: 'approved',
    publishedPriceUsdc: published.toFixed(6),
    priceBand: band,
    scores,
    reasons,
  };
}