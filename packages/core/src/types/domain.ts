/**
 * Shared domain types.
 *
 * These are the wire-format types used across packages and over the wire.
 * DB rows are typed by `@prisma/client`; service layer converts to these.
 */

export type UserRole = 'listener' | 'artist' | 'admin';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: UserRole;
  isArtist: boolean;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
}

export interface PublicWallet {
  id: string;
  address: string;
  balanceUsdc: string; // string to avoid float drift; 6 decimals
  pendingUsdc: string;
}

export interface PublicSong {
  id: string;
  slug: string;
  title: string;
  artistName: string;
  artistUsername: string;
  featuredNames: string[];
  producerName: string | null;
  description: string | null;
  coverUrl: string;
  audioUrl: string;
  durationSeconds: number;
  publishedPriceUsdc: string;
  artistRequestedPriceUsdc: string;
  playCount: number;
  createdAt: string;
}

export interface RoyaltyRecipient {
  username: string;
  role: 'artist' | 'featured' | 'producer';
  percentageBps: number; // basis points (10000 = 100%)
  walletAddress?: string; // resolved at payout time
}

export interface CuratorDecision {
  decision: 'approved' | 'rejected' | 'needs_changes' | 'manual_review';
  score: number;                       // 0–100 normalized (Phase 7 contract)
  suggestedPriceUsdc: number;          // number, not string (cleaner for UI; stringified at the persistence boundary)
  confidenceScore: number;             // 0–100; higher = stronger signals
  reasons: string[];
  categoryScores: {
    metadata: number;       // 0–20
    audioQuality: number;   // 0–20
    loudness: number;       // 0–20 (Phase 7 — EBU R128)
    artwork: number;        // 0–20 (Phase 7)
    duplicateRisk: number;  // 0–20 (inverted; 20 = clearly unique)
    spamRisk: number;       // 0–20 (inverted; 20 = clearly legitimate)
    marketability: number;  // 0–20 (engagement prediction)
  };
  rawMetrics: Record<string, number | string | boolean | null>;
}

export interface StreamSession {
  streamId: string;
  songId: string;
  startedAt: string;
  thresholdSec: number;
  charged: boolean;
  wsTicket: string;
}

export interface PaymentReceipt {
  paymentId: string;
  streamId: string;
  songId: string;
  amountUsdc: string;
  status: 'pending' | 'settled' | 'failed' | 'distributed';
  txHash: string | null;
  facilitatorTransferId: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface PayoutReceipt {
  payoutId: string;
  paymentId: string;
  recipientUsername: string;
  recipientAddress: string;
  amountUsdc: string;
  txHash: string | null;
  status: 'pending' | 'sent' | 'failed';
  createdAt: string;
}

// ════════════════════════════════════════════════════════════════════
// Phase 7 — Agent decision wire types
// ════════════════════════════════════════════════════════════════════

/** What Fan Agent decides per stream (Phase 7). */
export interface FanDecision {
  classification:
    | 'valid_stream'
    | 'partial_stream'
    | 'suspicious_stream'
    | 'fraudulent_stream'
    | 'self_play_artist'
    | 'self_play_recipient';
  /** 0–100 fraud score (0 = clean, 100 = definite fraud). */
  fraudScore: number;
  /** Should we trigger the payment at thresholdSec? */
  shouldCharge: boolean;
  /** When (in seconds from stream start) the payment should fire, if shouldCharge. */
  paymentTriggerSec?: number;
  /** Human-readable reasons; UI shows them in the AI Explainability card. */
  reasons: string[];
  /** Numeric breakdown used for tooltips + admin. */
  signals: Record<string, number>;
}

/** What Split Agent decides per settled payment. */
export interface SplitDecision {
  totalAmountUsdc: string;
  splits: Array<{
    username: string;
    role: string;
    splitPercentageBps: number;
    amountUsdc: string;
    payoutStatus: 'pending' | 'processing' | 'completed' | 'partial_failure' | 'failed';
    payoutId?: string;
    txHash?: string | null;
    failureReason?: string | null;
  }>;
  payoutStatus: 'pending' | 'processing' | 'completed' | 'partial_failure' | 'failed';
  /** Aggregate payment-level reconciliation. */
  reconciliation: {
    splitsAttempted: number;
    splitsCompleted: number;
    splitsFailed: number;
    amountSettled: string;
    amountPending: string;
  };
  reasons: string[];
}

/** Per-bucket recommendation (for Discovery Agent). */
export interface Recommendation {
  songId: string;
  score: number;
  bucket: 'for_you' | 'trending' | 'rising_artists' | 'because_you_listened';
  explanation: string; // e.g. "You completed 94% of similar afrobeat songs"
  signals: Record<string, number>;
}

/** What Fraud Sentinel decides per pattern. */
export interface FraudAlertPayload {
  severity: 'low' | 'medium' | 'high' | 'critical';
  entityType: 'user' | 'wallet' | 'song' | 'payment_cluster' | 'ip_cluster';
  entityId: string;
  score: number;
  reasons: string[];
  metricBreakdown: Record<string, number>;
  autoAction?: 'wallet_frozen' | 'payouts_paused' | 'account_locked';
}