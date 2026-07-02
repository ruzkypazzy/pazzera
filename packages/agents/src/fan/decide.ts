/**
 * Fan Agent v2 — per-stream decision function.
 *
 * Pure function: takes a stream's telemetry + history + environment,
 * decides:
 *
 *   - classification:   valid | partial | suspicious | fraudulent
 *   - fraudScore:       0–100
 *   - shouldCharge:     boolean (true if the listener has earned the
 *                       payment by crossing the threshold AND the
 *                       stream looks legitimate)
 *   - paymentTriggerSec: seconds-into-stream when should fire
 *   - reasons:          human-readable bullets
 *   - signals:          numeric breakdown for the AI Explainability UI
 *
 * Threshold default: 25% of the song's duration. An artist who asks
 * for 0.005 USDC/stream doesn't want to get ripped off by 30-second
 * skim plays, and a listener who bails early shouldn't pay.
 *
 * Signal sources:
 *   - listen duration vs threshold
 *   - mute state (if muted most of listen, treat as background)
 *   - visibility (if hidden most of listen, treat as farm)
 *   - seek behaviour (forward seeks beyond position; count of seeks)
 *   - playback speed (anything ≠ 1.0 lowers trust; 2x burns rewards fast)
 *   - repeated loops (single-stream looping re-trips the threshold)
 *   - device fingerprint reuse (different user on same device = suspicious)
 *   - IP clustering (same IP across many user accounts = fraud)
 *   - prior charge history (already charged for this song today = spam)
 *
 * Decision rules:
 *   fraud >= 75            → fraudulent    → never charge
 *   fraud >= 50            → suspicious    → never charge, send to manual review
 *   fraud >= 25            → partial       → charge only if listening > 50% threshold
 *   listen >= threshold    → valid + shouldCharge = true
 *   listen >= 0.5 * threshold → partial + shouldCharge = true
 *   else                   → partial or valid, shouldCharge = false
 */
import type { FanDecision } from '@pazzera/core';

export interface FanInput {
  streamId: string;
  songId: string;
  userId: string;
  songDurationSeconds: number;
  listenDurationSec: number;
  mutedDurationSec: number;
  hiddenDurationSec: number;
  seekCount: number;
  loopCount: number;
  maxPlaybackRate: number;
  deviceFingerprintSharedWithUsers: number; // number of OTHER users on this device
  ipSharedWithUsersLast24h: number;          // number of OTHER users on same IP in last 24h
  userPriorChargesForSongLast24h: number;    // count of streams user already paid for today
  userAccountAgeDays: number;
  // Threshold the catalog wants to cross before charging (e.g. 25%)
  thresholdPct: number;
  // Set by the worker if the listener is the song's primary artist
  // ('primary_artist') or a RoyaltyRecipient of any role on the song
  // ('featured_recipient'). Both skip the charge but still count as
  // a valid play.
  selfPlayKind: 'none' | 'primary_artist' | 'featured_recipient';
}

const FRAUD_FRAUDULENT = 75;
const FRAUD_SUSPICIOUS = 50;
const FRAUD_PARTIAL = 25;

export function decideFan(input: FanInput): FanDecision {
  const reasons: string[] = [];
  const signals: Record<string, number> = {};
  let fraud = 0;

  // ─── duration signal ────────────────────────────────────────
  const thresholdSec = Math.max(5, Math.round((input.songDurationSeconds * input.thresholdPct) / 100));
  const listenRatio = input.songDurationSeconds === 0 ? 0 : input.listenDurationSec / input.songDurationSeconds;
  signals.listenDurationSec = input.listenDurationSec;
  signals.thresholdSec = thresholdSec;
  signals.listenRatio = Number(listenRatio.toFixed(3));

  // ─── mute / hidden penalties ────────────────────────────────
  const mutedRatio =
    input.listenDurationSec === 0 ? 0 : Math.min(1, input.mutedDurationSec / Math.max(1, input.listenDurationSec));
  const hiddenRatio =
    input.listenDurationSec === 0 ? 0 : Math.min(1, input.hiddenDurationSec / Math.max(1, input.listenDurationSec));
  signals.mutedRatio = Number(mutedRatio.toFixed(3));
  signals.hiddenRatio = Number(hiddenRatio.toFixed(3));
  if (mutedRatio > 0.5) {
    fraud += 30;
    reasons.push(`Audio muted ${(mutedRatio * 100).toFixed(0)}% of listen time`);
  } else if (mutedRatio > 0.25) {
    fraud += 15;
    reasons.push(`Audio muted ${(mutedRatio * 100).toFixed(0)}% of listen time`);
  }
  if (hiddenRatio > 0.5) {
    fraud += 40;
    reasons.push(`Tab hidden ${(hiddenRatio * 100).toFixed(0)}% of listen time`);
  } else if (hiddenRatio > 0.25) {
    fraud += 20;
    reasons.push(`Tab hidden ${(hiddenRatio * 100).toFixed(0)}% of listen time`);
  }

  // ─── playback speed ─────────────────────────────────────────
  signals.maxPlaybackRate = input.maxPlaybackRate;
  if (input.maxPlaybackRate > 1.5) {
    fraud += 30;
    reasons.push(`Unusual playback rate (${input.maxPlaybackRate}x)`);
  } else if (input.maxPlaybackRate > 1.1) {
    fraud += 10;
    reasons.push(`Slightly elevated playback rate (${input.maxPlaybackRate}x)`);
  }

  // ─── seek behaviour ─────────────────────────────────────────
  signals.seekCount = input.seekCount;
  if (input.seekCount > 6) {
    fraud += 15;
    reasons.push(`Excessive seeking (${input.seekCount} seeks)`);
  }

  // ─── loop / farming ─────────────────────────────────────────
  signals.loopCount = input.loopCount;
  if (input.loopCount > 3) {
    fraud += 25;
    reasons.push(`Repeated loops (${input.loopCount} re-entries near threshold)`);
  }

  // ─── device fingerprint / IP ────────────────────────────────
  if (input.deviceFingerprintSharedWithUsers > 0) {
    fraud += 30;
    reasons.push(`Device shared with ${input.deviceFingerprintSharedWithUsers} other user(s)`);
  }
  signals.deviceSharedUsers = input.deviceFingerprintSharedWithUsers;

  if (input.ipSharedWithUsersLast24h >= 5) {
    fraud += 40;
    reasons.push(`IP shared with ${input.ipSharedWithUsersLast24h} users in 24h`);
  } else if (input.ipSharedWithUsersLast24h >= 2) {
    fraud += 15;
    reasons.push(`IP shared with ${input.ipSharedWithUsersLast24h} other users in 24h`);
  }
  signals.ipSharedUsers = input.ipSharedWithUsersLast24h;

  // ─── prior abuse of same song ───────────────────────────────
  if (input.userPriorChargesForSongLast24h >= 3) {
    fraud += 30;
    reasons.push(`Already streamed this song ${input.userPriorChargesForSongLast24h}x today`);
  } else if (input.userPriorChargesForSongLast24h >= 1) {
    fraud += 10;
    reasons.push(`Already streamed this song ${input.userPriorChargesForSongLast24h}x today`);
  }
  signals.userPriorCharges = input.userPriorChargesForSongLast24h;

  // ─── brand-new account heavy listen = high risk ─────────────
  if (input.userAccountAgeDays < 1 && listenRatio > 0.9) {
    fraud += 10;
    reasons.push('Brand-new account completed a long listen');
  }
  signals.accountAgeDays = input.userAccountAgeDays;

  // ─── duration cross-threshold ───────────────────────────────
  // Even a non-abusive stream is partial if it bails early.
  let classification: FanDecision['classification'];
  let shouldCharge = false;
  let paymentTriggerSec: number | undefined;

  // Self-play override: the primary artist or a featured recipient
  // listening to their own song never gets charged (the money would
  // just round-trip). They still count as a valid play (playCount
  // increment) and are still classified so we can attribute the listen.
  if (input.selfPlayKind === 'primary_artist') {
    classification = 'self_play_artist';
    shouldCharge = false;
    reasons.push('Listener is the primary artist of this song — no charge');
  } else if (input.selfPlayKind === 'featured_recipient') {
    classification = 'self_play_recipient';
    shouldCharge = false;
    reasons.push('Listener is a featured / royalty recipient on this song — no charge');
  } else if (fraud >= FRAUD_FRAUDULENT) {
    // First gate: classification is set by fraud severity
    classification = 'fraudulent_stream';
    shouldCharge = false;
    if (reasons.length === 0) reasons.push('Aggregated fraud severity in critical band');
  } else if (fraud >= FRAUD_SUSPICIOUS) {
    classification = 'suspicious_stream';
    shouldCharge = false;
    reasons.push('Fraud severity in suspicious band — admin review required');
  } else if (fraud >= FRAUD_PARTIAL) {
    classification = 'partial_stream';
    // can still charge if they actually listened beyond 1.5× threshold
    shouldCharge = input.listenDurationSec >= thresholdSec * 1.5;
    if (!shouldCharge) {
      reasons.push('Listen duration short of lenient charge threshold');
    }
  } else {
    // Clean stream — classification depends on whether they crossed threshold
    if (input.listenDurationSec >= thresholdSec) {
      classification = 'valid_stream';
      shouldCharge = true;
      paymentTriggerSec = thresholdSec;
    } else if (input.listenDurationSec >= thresholdSec * 0.5) {
      classification = 'partial_stream';
      // Don't charge if below full threshold
      shouldCharge = false;
      reasons.push('Listened half-threshold but not full — not enough for a charge');
    } else {
      classification = 'partial_stream';
      shouldCharge = false;
      reasons.push('Listen below half-threshold — preview only');
    }
  }

  if (paymentTriggerSec === undefined && shouldCharge) {
    paymentTriggerSec = Math.min(input.listenDurationSec, thresholdSec);
  }

  if (reasons.length === 0) {
    reasons.push('Listen behaviour within normal range');
  }

  return {
    classification,
    fraudScore: Math.min(100, Math.round(fraud)),
    shouldCharge,
    paymentTriggerSec: shouldCharge ? paymentTriggerSec : undefined,
    reasons,
    signals,
  };
}