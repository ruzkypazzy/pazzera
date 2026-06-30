/**
 * Phase 8 — Wire-format types + Zod validator for every realtime payload.
 *
 * The server is the source of truth. The client's job is to be a well-behaved
 * echo of the listener's actions. Anything that passes schema validation is
 * written into a PlaybackTick row; anything that fails increments the per-socket
 * `invalidPayloads` counter (5 strikes → auto-disconnect).
 */
import { z } from 'zod';

export const PLAYBACK_TICK_INTERVAL_MS = 5_000;
export const MIN_TICK_INTERVAL_MS = 2_000;
export const MAX_BUFFERED_TICKS = 60; // 5 minutes worth at 5s
export const MAX_INVALID_PAYLOADS = 5;
export const PAYMENT_NONCE_TTL_SEC = 600;
export const PAYMENT_THRESHOLD_PCT = 25;
export const SUSPICIOUS_SCORE_AUTO_ENQUEUE = 50;

export const TickSchema = z.object({
  sessionId: z.string().min(8).max(200), // sessionToken — server-issued
  songId: z.string().min(1).max(64),
  currentTimeSec: z.number().min(0).max(60 * 60 * 4),
  durationSec: z.number().min(1).max(60 * 60 * 4),
  muted: z.boolean(),
  hidden: z.boolean(),
  playbackRate: z.number().min(0.25).max(4),
  volume: z.number().min(0).max(1),
  timestamp: z.number().int().nonnegative(),
  queuePosition: z.number().int().min(0).max(1000),
  // Optional client-side buffered event
  seekFromSec: z.number().optional(),
  seekToSec: z.number().optional(),
});

export type PlaybackTickPayload = z.infer<typeof TickSchema>;

export const StreamStartSchema = TickSchema.extend({
  userId: z.string().min(1).max(64),
  isResume: z.boolean().optional(),
  bufferedSinceMs: z.number().optional(),
});

export type StreamStartPayload = z.infer<typeof StreamStartSchema>;

export const StreamEndSchema = z.object({
  sessionId: z.string().min(8),
  songId: z.string(),
  reason: z.enum(['natural', 'skipped', 'aborted', 'paused_timeout']),
  finalPositionSec: z.number().min(0),
  timestamp: z.number(),
});

export type StreamEndPayload = z.infer<typeof StreamEndSchema>;

export const StreamSeekSchema = z.object({
  sessionId: z.string().min(8),
  songId: z.string(),
  fromSec: z.number().min(0),
  toSec: z.number().min(0).max(60 * 60 * 4),
  timestamp: z.number(),
});

export type StreamSeekPayload = z.infer<typeof StreamSeekSchema>;

export const StreamPauseSchema = z.object({
  sessionId: z.string().min(8),
  songId: z.string(),
  positionSec: z.number().min(0),
  timestamp: z.number(),
});

export type StreamPausePayload = z.infer<typeof StreamPauseSchema>;

export const StreamResumeSchema = z.object({
  sessionId: z.string().min(8),
  songId: z.string(),
  positionSec: z.number().min(0),
  timestamp: z.number(),
});

export type StreamResumePayload = z.infer<typeof StreamResumeSchema>;

export const StreamResumeAckSchema = z.object({
  streamId: z.string(),
  serverTime: z.number(),
  thresholdSec: z.number(),
  acceptedTicks: z.number(),
  rejectedTicks: z.number().optional(),
});

export type StreamResumeAckPayload = z.infer<typeof StreamResumeAckSchema>;

export const ServerTickAckSchema = z.object({
  streamId: z.string(),
  timestamp: z.number(),
  accumulatedMs: z.number(),
  thresholdCrossed: z.boolean(),
});

export type ServerTickAckPayload = z.infer<typeof ServerTickAckSchema>;

export const PaymentDueSchema = z.object({
  songId: z.string(),
  streamId: z.string(),
  amountUsdc: z.string(),
  pricingTier: z.enum(['0.001', '0.002', '0.003', '0.004', '0.005']),
  authorizationRequired: z.boolean(),
  nonce: z.string().min(16),
  expiresAtSec: z.number(),
});

export type PaymentDuePayload = z.infer<typeof PaymentDueSchema>;

export const PaymentSettledSchema = z.object({
  streamId: z.string(),
  paymentId: z.string(),
  songId: z.string(),
  amountUsdc: z.string(),
  recipientCount: z.number().int().min(1),
  txHash: z.string(),
  payoutStatus: z.enum(['pending', 'processing', 'completed', 'partial_failure', 'failed']),
  settlesAt: z.number(),
});

export type PaymentSettledPayload = z.infer<typeof PaymentSettledSchema>;

export const PaymentFailedSchema = z.object({
  streamId: z.string(),
  paymentId: z.string().optional(),
  reason: z.enum(['user_rejected', 'expired', 'insufficient_balance', 'chain_error', 'rate_limited']),
  message: z.string(),
  retryAfterSec: z.number().optional(),
});

export type PaymentFailedPayload = z.infer<typeof PaymentFailedSchema>;

export const ThresholdCrossedSchema = z.object({
  streamId: z.string(),
  songId: z.string(),
  crossedAtSec: z.number(),
  thresholdSec: z.number(),
  fanClassification: z.enum(['valid_stream', 'partial_stream', 'suspicious_stream', 'fraudulent_stream']),
});

export type ThresholdCrossedPayload = z.infer<typeof ThresholdCrossedSchema>;

export const ErrorSchema = z.object({
  code: z.enum([
    'INVALID_PAYLOAD',
    'UNAUTHENTICATED',
    'RATE_LIMITED',
    'STREAM_NOT_FOUND',
    'WRONG_USER',
    'BUFFER_OVERFLOW',
    'INTERNAL',
  ]),
  message: z.string(),
});

export type ErrorPayload = z.infer<typeof ErrorSchema>;
