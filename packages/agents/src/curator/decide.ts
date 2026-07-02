/**
 * Curator Agent — pure decision function.
 *
 * v3 scoring model (7 dimensions × 20 = 140 raw, normalized 0–100):
 *
 *   metadata       (0–20) — completeness of artist-submitted fields
 *   audioQuality   (0–20) — bitrate, sample rate, codec, channels, peak
 *   spam           (0–20) — inverted; 20 = clearly legitimate
 *   duplicate      (0–20) — inverted; 20 = clearly unique (binary + acoustic)
 *   market         (0–20) — engagement prediction (artist history, recipients)
 *   loudness       (0–20) — EBU R128 normalized, no clipping, no over-compression
 *   artwork        (0–20) — cover resolution, aspect ratio, square-ness
 *
 * Phase 7: also emits `confidence` and `categoryScores` for the
 * AI Explainability UI. Confidence is derived from the spread of the
 * weakest dimension relative to the strongest; tighter spread = higher
 * confidence.
 *
 * Decision:
 *
 *   normalized < 31                → rejected
 *   duplicate === 0 || spam < 6    → rejected (terminal)
 *   audio < 6 || loudness < 4      → needs_changes
 *   normalized >= 31 but < 60      → manual_review (added Phase 7)
 *   otherwise                      → approved (with priced band)
 *
 * Pricing bands (after totalScore computed, normalized to 100):
 *
 *   96 ≤ x ≤ 100    → 0.005 USDC
 *   86 ≤ x <  96    → 0.004 USDC
 *   71 ≤ x <  86    → 0.003 USDC
 *   51 ≤ x <  71    → 0.002 USDC
 *   31 ≤ x <  51    → 0.001 USDC
 *
 * The artist's requested price is a ceiling, never exceeded.
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
    peakDb: number;
    codec?: string;
    containerFormat?: string;
    silenceRatio?: number | null;
    lufsIntegrated?: number | null;
    lufsRange?: number | null;
    truePeakDb?: number | null;
  };
  artistHistory: {
    totalSongs: number;
    approvedSongs: number;
    rejectedSongs: number;
    flaggedForSpam: number;
  };
  duplicate: {
    binaryHashMatch: boolean;
    acousticHashMatch: boolean;
  };
  usernamesResolved: boolean;
  recipientCount: number;
  artwork: {
    widthPx: number;
    heightPx: number;
    isSquare: boolean;
    aspectRatio: number;
  };
}

export interface CuratorCategoryScores {
  metadata: number;
  audioQuality: number;
  loudness: number;
  artwork: number;
  duplicateRisk: number;
  spamRisk: number;
  marketability: number;
}

export interface CuratorDecisionInternal extends CuratorDecision {
  scoreBreakdown: CuratorCategoryScores & { totalRaw: number; normalized: number };
}

// v4: relaxed thresholds — curator is an assist gate, not a mastering
// inspector. Most real uploads from bedroom producers / streaming-
// mastered tracks should pass.
const REJECT_THRESHOLD = 25;
const NEEDS_CHANGES_AUDIO_THRESHOLD = 4;
const NEEDS_CHANGES_LOUDNESS_THRESHOLD = 3;
const APPROVE_THRESHOLD = 35; // anything at or above this → approved
const FRAUD_REJECT_THRESHOLD = 4;

const PRICE_BANDS: Array<{ min: number; max: number; price: number }> = [
  { min: 86, max: 101, price: 0.005 },
  { min: 71, max: 86, price: 0.004 },
  { min: 51, max: 71, price: 0.003 },
  { min: 35, max: 51, price: 0.002 },
  { min: 25, max: 35, price: 0.001 },
];

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function priceForTotal(total: number): { price: number; band: string } {
  const band = PRICE_BANDS.find((b) => total >= b.min && total < b.max);
  return band ? { price: band.price, band: band.price.toFixed(3) } : { price: 0, band: 'rejected' };
}

/**
 * Confidence — how strongly do all dimensions agree?
 * A track with all dimensions clustered near the same value is more
 * confident than one with one huge dimension and one weak one.
 *
 * Formula: 100 - stdev-as-percent-of-20. Lower spread = higher confidence.
 * Then floor on terminal rejections (we're very confident something is bad).
 */
function confidenceForScores(scores: CuratorCategoryScores, decision: CuratorDecision['decision']): number {
  const dims = Object.values(scores);
  const mean = dims.reduce((s, n) => s + n, 0) / dims.length;
  const variance = dims.reduce((s, n) => s + (n - mean) ** 2, 0) / dims.length;
  const stdev = Math.sqrt(variance);
  // stdev max ≈ 10 (0..20 range). Map stdev → penalty.
  let confidence = Math.max(0, Math.min(100, Math.round(100 - stdev * 10)));
  // Stronger floor for clear-cut cases
  if (decision === 'rejected' || decision === 'approved') {
    confidence = Math.max(confidence, 70);
  }
  return confidence;
}

export function decideCurator(input: CuratorInput): CuratorDecisionInternal {
  const reasons: string[] = [];
  const rawMetrics: Record<string, number | string | boolean | null> = {};

  // ─── metadata (0–20) ────────────────────────────────────────
  let metadata = 0;
  if (input.metadata.title.length >= 3 && input.metadata.title.length <= 80) {
    metadata += 4;
  } else if (input.metadata.title.length > 80) {
    metadata += 1;
    reasons.push('Title unusually long');
  }
  if (input.metadata.artistName.length >= 2) metadata += 3;
  if (input.metadata.featuredNames.length > 0) metadata += 2;
  if (input.metadata.producerName) metadata += 2;
  if (input.metadata.description && input.metadata.description.length >= 60) {
    metadata += 3;
  } else if (input.metadata.description && input.metadata.description.length >= 20) {
    metadata += 1;
  } else {
    reasons.push('Description too short (<60 chars recommended)');
  }
  if (input.usernamesResolved) {
    metadata += 4;
  } else {
    reasons.push('One or more Pazzera usernames could not be resolved');
  }
  if (input.metadata.coverUrl) metadata += 2;

  rawMetrics.metadataTitleLength = input.metadata.title.length;
  rawMetrics.metadataFeaturedCount = input.metadata.featuredNames.length;

  // ─── audio quality (0–20) ─────────────────────────────────
  let audio = 0;
  if (input.audioQuality.bitrateKbps >= 320) audio += 6;
  else if (input.audioQuality.bitrateKbps >= 256) audio += 5;
  else if (input.audioQuality.bitrateKbps >= 192) audio += 3;
  else if (input.audioQuality.bitrateKbps >= 128) audio += 2;
  else {
    reasons.push('Audio bitrate below 128 kbps minimum');
  }
  if (input.audioQuality.sampleRateHz >= 48000) audio += 4;
  else if (input.audioQuality.sampleRateHz >= 44100) audio += 3;
  else if (input.audioQuality.sampleRateHz >= 22050) audio += 1;
  if (input.audioQuality.channels >= 2) audio += 2;
  else audio += 1;
  if (input.audioQuality.codec === 'flac' || input.audioQuality.codec === 'mp3') audio += 1;
  if (input.audioQuality.peakDb !== undefined && input.audioQuality.peakDb > -0.5) {
    // v4: only treat true full-scale clipping (> -0.5 dBFS) as a
    // problem, and only as a soft nudge. Streaming-loud masters
    // (peak -0.5 to -1 dBFS) are fine.
    audio -= 1;
    reasons.push('Audio peaks very close to 0 dBFS — consider leaving a touch more headroom');
  } else if (input.audioQuality.peakDb !== undefined && input.audioQuality.peakDb > -3) {
    audio -= 0; // warm masters are fine
  } else {
    audio += 2;
  }
  if (input.audioQuality.silenceRatio !== null && input.audioQuality.silenceRatio !== undefined) {
    if (input.audioQuality.silenceRatio > 0.5) {
      audio -= 2;
      reasons.push('Excessive silence (>50% of duration)');
    } else if (input.audioQuality.silenceRatio < 0.2) {
      audio += 2;
    }
  }
  rawMetrics.audioBitrateKbps = input.audioQuality.bitrateKbps;
  rawMetrics.audioSampleRateHz = input.audioQuality.sampleRateHz;
  rawMetrics.audioChannels = input.audioQuality.channels;

  // ─── loudness (0–20) — EBU R128 scoring ────────────────────
  let loudness = 12;
  if (input.audioQuality.lufsIntegrated !== undefined && input.audioQuality.lufsIntegrated !== null) {
    const l = input.audioQuality.lufsIntegrated;
    if (l >= -18 && l <= -13) loudness = 18;
    else if (l >= -23 && l <= -10) loudness = 14;
    else if (l < -30) {
      loudness = 6;
      reasons.push('Audio is very quiet (below -30 LUFS) — listener will need to crank volume');
    } else if (l > -8) {
      loudness = 4;
      reasons.push('Audio is extremely loud (above -8 LUFS) — clipping risk on consumer devices');
    } else loudness = 9;
  }
  if (input.audioQuality.lufsRange !== undefined && input.audioQuality.lufsRange !== null) {
    const lr = input.audioQuality.lufsRange;
    if (lr > 18) {
      loudness -= 3;
      reasons.push('Excessive dynamic range (>18 LU) — hard to listen in noisy environments');
    } else if (lr < 2) {
      // v4: only brick-walled masters (LU range < 2) are flagged.
      // Modern streaming loudness (3-6 LU) is normal and loud.
      loudness -= 2;
      reasons.push('Audio is heavily compressed (LU range < 2) — consider more dynamics');
    } else {
      loudness += 2;
    }
  }
  // v4: true-peak warning only above -0.1 dBTP, as a soft nudge.
  if (input.audioQuality.truePeakDb !== undefined && input.audioQuality.truePeakDb !== null) {
    if (input.audioQuality.truePeakDb > -0.1) {
      loudness -= 1;
      reasons.push('True peak very close to 0 dBTP — intersample peaks may clip on some devices');
    }
  }
  rawMetrics.lufsIntegrated = input.audioQuality.lufsIntegrated ?? null;
  rawMetrics.lufsRange = input.audioQuality.lufsRange ?? null;

  // ─── spam (0–20) ───────────────────────────────────────────
  let spam = 20;
  if (input.artistHistory.flaggedForSpam > 0) {
    spam -= Math.min(8, input.artistHistory.flaggedForSpam * 2);
    reasons.push(`Artist has ${input.artistHistory.flaggedForSpam} prior spam flags`);
  }
  if (input.artistHistory.totalSongs > 0 && input.artistHistory.rejectedSongs / input.artistHistory.totalSongs > 0.5) {
    spam -= 5;
    reasons.push('Artist rejection rate > 50%');
  }
  if (input.metadata.description && /(https?:\/\/|free money|click here|whatsapp|telegram me|buy now|dm me)/i.test(input.metadata.description)) {
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
  rawMetrics.spamFlags = input.artistHistory.flaggedForSpam;

  // ─── duplicate (0–20) ──────────────────────────────────────
  let duplicate = 20;
  if (input.duplicate.binaryHashMatch) {
    duplicate = 0;
    reasons.push('Exact duplicate: binary hash matches an existing song');
  } else if (input.duplicate.acousticHashMatch) {
    duplicate = 4;
    reasons.push('Acoustic fingerprint matches an existing song — likely a re-encode');
  } else if (input.artistHistory.totalSongs > 10 && input.artistHistory.approvedSongs / input.artistHistory.totalSongs < 0.5) {
    duplicate -= 3;
    reasons.push('Many previous low-quality uploads from this artist');
  }
  rawMetrics.binaryDuplicate = input.duplicate.binaryHashMatch;
  rawMetrics.acousticDuplicate = input.duplicate.acousticHashMatch;

  // ─── market (0–20) ─────────────────────────────────────────
  let market = 10;
  if (input.artistHistory.totalSongs >= 5) market += 2;
  if (input.artistHistory.approvedSongs >= 3) market += 2;
  if (input.artistHistory.approvedSongs / Math.max(1, input.artistHistory.totalSongs) > 0.8) market += 2;
  if (input.recipientCount >= 3) market += 2;
  else if (input.recipientCount === 1) market -= 2;
  if (input.metadata.durationSeconds >= 120 && input.metadata.durationSeconds <= 360) market += 2;
  else if (input.metadata.durationSeconds < 60 || input.metadata.durationSeconds > 600) market -= 1;

  // ─── artwork (0–20) ────────────────────────────────────────
  let artwork = 10;
  const minSide = Math.min(input.artwork.widthPx, input.artwork.heightPx);
  if (minSide >= 1000) artwork += 5;
  else if (minSide >= 500) artwork += 3;
  else artwork -= 4;
  if (input.artwork.isSquare) artwork += 3;
  else if (input.artwork.aspectRatio >= 0.9 && input.artwork.aspectRatio <= 1.1) artwork += 1;
  else artwork -= 2;
  rawMetrics.artworkMinPx = minSide;

  // ─── Clamp + total ──────────────────────────────────────────
  const categoryScores: CuratorCategoryScores = {
    metadata: clampInt(metadata, 0, 20),
    audioQuality: clampInt(audio, 0, 20),
    loudness: clampInt(loudness, 0, 20),
    artwork: clampInt(artwork, 0, 20),
    duplicateRisk: clampInt(duplicate, 0, 20),
    spamRisk: clampInt(spam, 0, 20),
    marketability: clampInt(market, 0, 20),
  };
  const totalRaw =
    categoryScores.metadata +
    categoryScores.audioQuality +
    categoryScores.loudness +
    categoryScores.artwork +
    categoryScores.duplicateRisk +
    categoryScores.spamRisk +
    categoryScores.marketability;
  const normalized = Math.round((totalRaw / 140) * 100);

  // ─── Decision (use normalized) — v4 relaxed ─────────────────
  let decision: CuratorDecision['decision'];
  if (categoryScores.duplicateRisk === 0) {
    decision = 'rejected';
  } else if (categoryScores.spamRisk < FRAUD_REJECT_THRESHOLD) {
    decision = 'rejected';
  } else if (normalized < REJECT_THRESHOLD) {
    decision = 'rejected';
  } else if (categoryScores.audioQuality < NEEDS_CHANGES_AUDIO_THRESHOLD) {
    decision = 'needs_changes';
  } else if (categoryScores.loudness < NEEDS_CHANGES_LOUDNESS_THRESHOLD) {
    decision = 'needs_changes';
    reasons.push('Audio loudness is in the rejection band — please re-master');
  } else if (normalized < APPROVE_THRESHOLD) {
    // Borderline — needs_changes nudge, not blocked.
    decision = 'needs_changes';
    reasons.push(`Normalized score ${normalized}/100 in the borderline band (35-50) — re-upload once you've polished for a higher tier`);
  } else {
    decision = 'approved';
  }

  // ─── Pricing (only if approved / manual_review positive) ───
  let suggestedPriceUsdc = 0;
  let band = 'rejected';
  if (decision === 'approved') {
    const p = priceForTotal(normalized);
    const requested = Math.max(0.001, Math.min(0.005, input.artistRequestedPriceUsdc));
    suggestedPriceUsdc = Math.min(requested, p.price);
    band = p.band;
    if (suggestedPriceUsdc < requested) {
      reasons.push(`Price lowered from ${requested} to ${suggestedPriceUsdc.toFixed(3)} USDC — score ${normalized}/100 → band ${band}`);
    }
  } else if (decision === 'manual_review') {
    suggestedPriceUsdc = 0;
    band = 'manual_review';
  } else if (decision === 'needs_changes') {
    suggestedPriceUsdc = 0;
    band = 'needs_changes';
  } else {
    suggestedPriceUsdc = 0;
    band = 'rejected';
  }

  const confidenceScore = confidenceForScores(categoryScores, decision);

  return {
    decision,
    score: normalized,
    suggestedPriceUsdc,
    confidenceScore,
    reasons: reasons.length ? reasons : ['Total score below acceptance threshold'],
    categoryScores,
    rawMetrics,
    scoreBreakdown: { ...categoryScores, totalRaw, normalized },
  };
}