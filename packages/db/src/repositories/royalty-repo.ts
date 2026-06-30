/**
 * RoyaltyRecipient repository.
 *
 * Enforces sum(splitPercentageBps) === 10000 at write time.
 */
import { prisma } from '../client';
import { ConflictError } from '@pazzera/core';

export type RoyaltyRecipientInput = {
  userId?: string | null;
  externalWalletAddress?: string | null;
  externalLabel?: string | null;
  username: string;
  role: 'primary_artist' | 'featured_artist' | 'producer' | 'songwriter' | 'label' | 'custom';
  splitPercentageBps: number;
  payoutPriority?: number;
};

const VALID_ROLES = new Set([
  'primary_artist',
  'featured_artist',
  'producer',
  'songwriter',
  'label',
  'custom',
]);

function assertValidRecipients(recipients: RoyaltyRecipientInput[]) {
  if (recipients.length === 0) {
    throw new ConflictError('At least one recipient required');
  }
  for (const r of recipients) {
    if (!VALID_ROLES.has(r.role)) {
      throw new ConflictError(`Invalid role: ${r.role}`);
    }
    if (r.userId == null && !r.externalWalletAddress) {
      throw new ConflictError(
        `Recipient ${r.username}: must specify userId or externalWalletAddress`,
      );
    }
    if (r.userId != null && r.externalWalletAddress) {
      throw new ConflictError(
        `Recipient ${r.username}: cannot specify both userId and externalWalletAddress`,
      );
    }
    if (r.splitPercentageBps < 0 || r.splitPercentageBps > 10000) {
      throw new ConflictError(
        `Recipient ${r.username}: splitPercentageBps must be 0..10000`,
      );
    }
  }
  const sum = recipients.reduce((s, r) => s + r.splitPercentageBps, 0);
  if (sum !== 10000) {
    throw new ConflictError(
      `Recipient splits must sum to 10000 bps, got ${sum}`,
    );
  }
}

export const RoyaltyRepo = {
  async setRecipients(songId: string, recipients: RoyaltyRecipientInput[]) {
    assertValidRecipients(recipients);
    return prisma.$transaction([
      prisma.royaltyRecipient.deleteMany({ where: { songId } }),
      prisma.royaltyRecipient.createMany({
        data: recipients.map((r, i) => ({
          songId,
          userId: r.userId ?? null,
          externalWalletAddress: r.externalWalletAddress ?? null,
          externalLabel: r.externalLabel ?? null,
          username: r.username,
          role: r.role,
          splitPercentageBps: r.splitPercentageBps,
          payoutPriority: r.payoutPriority ?? 100 + i, // default: insertion order
        })),
      }),
    ]);
  },
  async listForSong(songId: string) {
    return prisma.royaltyRecipient.findMany({
      where: { songId },
      orderBy: { payoutPriority: 'asc' },
      include: { user: { include: { wallet: true } } },
    });
  },
  async validateSplits(songId: string) {
    const recipients = await prisma.royaltyRecipient.findMany({ where: { songId } });
    const sum = recipients.reduce((s, r) => s + r.splitPercentageBps, 0);
    return { recipients, sum, valid: sum === 10000 && recipients.length > 0 };
  },
};