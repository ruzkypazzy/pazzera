/**
 * Wallet repository.
 */
import { prisma } from '../client';

export const WalletRepo = {
  async findByUserId(userId: string) {
    return prisma.wallet.findUnique({ where: { userId } });
  },
  async findByAddress(address: string) {
    return prisma.wallet.findUnique({ where: { address } });
  },
  async create(data: {
    userId: string;
    address: string;
    encryptedPrivateKey: string;
  }) {
    return prisma.wallet.create({
      data: { ...data, status: 'active' },
    });
  },
  async setStatus(
    walletId: string,
    status: 'pending_provisioning' | 'active' | 'frozen' | 'compromised' | 'recovery_requested',
    opts?: { reason?: string },
  ) {
    const patch: Record<string, unknown> = { status };
    if (status === 'frozen') {
      patch.frozenAt = new Date();
      patch.frozenReason = opts?.reason ?? null;
    } else if (status === 'compromised') {
      patch.compromisedAt = new Date();
    } else if (status === 'recovery_requested') {
      patch.recoveryRequestedAt = new Date();
    } else if (status === 'active') {
      patch.frozenAt = null;
      patch.frozenReason = null;
    }
    return prisma.wallet.update({ where: { id: walletId }, data: patch });
  },
  async updateBalance(walletId: string, balanceUsdc: string, pendingUsdc?: string) {
    return prisma.wallet.update({
      where: { id: walletId },
      data: { balanceUsdc, ...(pendingUsdc ? { pendingUsdc } : {}) },
    });
  },
  async incrementBalance(walletId: string, amountBaseUnits: bigint) {
    // Atomic add — we model balanceUsdc as a string; raw SQL increment.
    return prisma.$executeRaw`
      UPDATE "Wallet"
      SET "balanceUsdc" = (CAST("balanceUsdc" AS NUMERIC) + ${amountBaseUnits.toString()}::numeric)::text,
          "updatedAt" = now()
      WHERE "id" = ${walletId}
    `;
  },
  async setLastIndexedBlock(walletId: string, block: bigint) {
    return prisma.wallet.update({
      where: { id: walletId },
      data: { lastIndexedBlock: block },
    });
  },
};