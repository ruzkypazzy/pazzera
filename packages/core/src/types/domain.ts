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
  decision: 'approved' | 'rejected' | 'needs_changes';
  publishedPriceUsdc: string;
  reasons: string[];
  metadata: {
    metadataScore: number;
    audioQualityScore: number;
    spamScore: number;
    duplicateOfSongId: string | null;
  };
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