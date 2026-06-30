/**
 * Curator Agent — pure decision function.
 *
 * Scoring model v3 — 7 dimensions, each 0–20, total 0–140 (normalized
 * to 0–100 for storage + UI):
 *
 *   metadata       (0–20) — completeness of artist-submitted fields
 *   audioQuality   (0–20) — bitrate, sample rate, codec, channels, LUFS, peak
 *   spam           (0–20) — inverted; 20 = clearly legitimate
 *   duplicate      (0–20) — inverted; 20 = clearly unique (binary + acoustic)
 *   market         (0–20) — engagement prediction (artist history, recipients)
 *   loudness       (0–20) — EBU R128 normalized, no clipping, no over-compression
 *   artwork        (0–20) — cover resolution, aspect ratio, square-ness
 *
 * Pricing bands (after totalScore computed, normalized to 100):
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
    peakDb: number;
    codec?: string;
    containerFormat?: string;
    silenceRatio?: number | null;
    lufsIntegrated?: number | null; // -70 = silence
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
    /** True if the binary hash matches another approved song. */
    binaryHashMatch: boolean;
    /** True if the acoustic hash matches another approved song. */
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

export interface CuratorScore {
  metadata: number;     // 0–20
  audio: number;        // 0–20
  spam: number;         // 0–20 (higher = better)
  duplicate: number;    // 0–20 (higher = better)
  market: number;       // 0–20
  loudness: number;     // 0–20
  artwork: number;      // 0–20
  /** 0–140 (sum of dimensions) */
  total: number;
  /** 0–100 (normalized). */
  normalized: number;
}

export interface CuratorDecisionV3 {
  decision: 'approved' | 'rejected' | 'needs_changes' | 'suspended';
  publishedPriceUsdc: string;
  priceBand: string;
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
  return band ? { price: band.price, band: band.price.toFixed(3) } : { price: 0, band: 'rejected' };
}

export function decideCurator(input: CuratorInput): CuratorDecisionV3 {
  const reasons: string[] = [];

  // ─── metadata (0–20) ────────────────────────────────────────
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

  // ─── audio quality (0–20) ─────────────────────────────────
  let audio = 0;
  if (input.audioQuality.bitrateKbps >= 320) audio += 6;
  else if (input.audioQuality.bitrateKbps >= 256) audio += 5;
  else if (input.audioQuality.bitrateKbps >= 192) audio += 3;
  else if (input.audioQuality.bitrateKbps >= 128) audio += 2;
  else {
    audio += 0;
    reasons.push('Audio bitrate below 128 kbps minimum');
  }
  if (input.audioQuality.sampleRateHz >= 48000) audio += 4;
  else if (input.audioQuality.sampleRateHz >= 44100) audio += 3;
  else if (input.audioQuality.sampleRateHz >= 22050) audio += 1;
  if (input.audioQuality.channels >= 2) audio += 2;
  else audio += 1;
  if (input.audioQuality.codec === 'flac' || input.audioQuality.codec === 'mp3') audio += 1;
  if (input.audioQuality.peakDb !== undefined && input.audioQuality.peakDb > -1) {
    audio -= 3;
    reasons.push('Audio clips heavily (peak > -1 dBFS)');
  } else if (input.audioQuality.peakDb !== undefined && input.audioQuality.peakDb > -3) {
    audio -= 1;
    reasons.push('Audio peaks above -3 dBFS (possible clipping)');
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

  // ─── loudness (0–20) — EBU R128 scoring ────────────────────
  // Pazzera targets streaming-optimized -16 LUFS integrated with
  // ≤ 11 LU range. Reward tracks in band; penalize extremes.
  let loudness = 12; // neutral baseline
  if (input.audioQuality.lufsIntegrated !== undefined && input.audioQuality.lufsIntegrated !== null) {
    const l = input.audioQuality.lufsIntegrated;
    if (l >= -18 && l <= -13) {
      // Sweet spot
      loudness = 18;
    } else if (l >= -23 && l <= -10) {
      // Acceptable
      loudness = 14;
    } else if (l < -30) {
      loudness = 6;
      reasons.push('Audio is very quiet (below -30 LUFS) — listener will need to crank volume');
    } else if (l > -8) {
      loudness = 4;
      reasons.push('Audio is extremely loud (above -8 LUFS) — risk of clipping on consumer devices');
    } else {
      loudness = 9;
    }
  }
  // Loudness range (dynamics) — > 18 LU = too dynamic, < 4 LU = over-compressed
  if (input.audioQuality.lufsRange !== undefined && input.audioQuality.lufsRange !== null) {
    const lr = input.audioQuality.lufsRange;
    if (lr > 18) {
      loudness -= 3;
      reasons.push('Excessive dynamic range (>18 LU) — hard to listen in noisy environments');
    } else if (lr < 4) {
      loudness -= 4;
      reasons.push('Audio is over-compressed (LU range < 4) — likely mastering abuse');
    } else {
      loudness += 2;
    }
  }
  // True peak (digital clipping safety) — > -1 dBTP is bad
  if (input.audioQuality.truePeakDb !== undefined && input.audioQuality.truePeakDb !== null) {
    if (input.audioQuality.truePeakDb > -0.5) {
      loudness -= 3;
      reasons.push('True peak above -0.5 dBTP — intersample clipping risk');
    }
  }

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

  // ─── duplicate (0–20) — binary + acoustic ──────────────────
  let duplicate = 20;
  if (input.duplicate.binaryHashMatch) {
    duplicate = 0;
    reasons.push('Exact duplicate: binary hash matches an existing song');
  } else if (input.duplicate.acousticHashMatch) {
    duplicate = 4;
    reasons.push('Acoustic fingerprint matches an existing song — likely a re-encode of the same track');
  } else if (input.artistHistory.totalSongs > 0) {
    // Mild signal: same artist uploaded many same-length tracks
    if (input.artistHistory.totalSongs > 10 && input.artistHistory.approvedSongs / input.artistHistory.totalSongs < 0.5) {
      duplicate -= 3;
      reasons.push('Many previous low-quality uploads from this artist');
    }
  }

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
  // Resolution
  const minSide = Math.min(input.artwork.widthPx, input.artwork.heightPx);
  if (minSide >= 1000) artwork += 5;
  else if (minSide >= 500) artwork += 3;
  else artwork -= 4;
  // Square ratio (recommended for streaming)
  if (input.artwork.isSquare) artwork += 3;
  else if (input.artwork.aspectRatio >= 0.9 && input.artwork.aspectRatio <= 1.1) artwork += 1;
  else artwork -= 2;

  // ─── Clamp + total ──────────────────────────────────────────
  const scores: CuratorScore = {
    metadata: clampInt(metadata, 0, 20),
    audio: clampInt(audio, 0, 20),
    spam: clampInt(spam, 0, 20),
    duplicate: clampInt(duplicate, 0, 20),
    market: clampInt(market, 0, 20),
    loudness: clampInt(loudness, 0, 20),
    artwork: clampInt(artwork, 0, 20),
    total: 0,
    normalized: 0,
  };
  scores.total =
    scores.metadata +
    scores.audio +
    scores.spam +
    scores.duplicate +
    scores.market +
    scores.loudness +
    scores.artwork;
  // Normalize 0–140 → 0–100
  scores.normalized = Math.round((scores.total / 140) * 100);

  // ─── Decision (use normalized) ──────────────────────────────
  if (scores.normalized < REJECT_THRESHOLD) {
    return {
      decision: 'rejected',
      publishedPriceUsdc: '0',
      priceBand: 'rejected',
      scores,
      reasons: reasons.length ? reasons : ['Total score below acceptance threshold'],
    };
  }
  if (scores.duplicate === 0) {
    return { decision: 'rejected', publishedPriceUsdc: '0', priceBand: 'rejected', scores, reasons };
  }
  if (scores.spam < 6) {
    return { decision: 'rejected', publishedPriceUsdc: '0', priceBand: 'rejected', scores, reasons };
  }
  if (scores.audio < 6) {
    return { decision: 'needs_changes', publishedPriceUsdc: '0', priceBand: 'needs_changes', scores, reasons };
  }
  if (scores.loudness < 4) {
    return { decision: 'needs_changes', publishedPriceUsdc: '0', priceBand: 'needs_changes', scores, reasons: [...reasons, 'Audio loudness is in the rejection band — please re-master'] };
  }

  // ─── Pricing ──────────────────────────────────────────────
  const { price: bandPrice, band } = priceForTotal(scores.normalized);
  const requested = Math.max(0.001, Math.min(0.005, input.artistRequestedPriceUsdc));
  const published = Math.min(requested, bandPrice);

  if (published < requested) {
    reasons.push(`Price lowered from ${requested} to ${published.toFixed(3)} USDC — normalized score ${scores.normalized}/100 maps to band ${band}`);
  }

  return {
    decision: 'approved',
    publishedPriceUsdc: published.toFixed(6),
    priceBand: band,
    scores,
    reasons,
  };
}