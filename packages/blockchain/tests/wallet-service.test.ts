/**
 * Integration test: wallet provision + balance + transaction lifecycle.
 *
 * Requires:
 *   - DATABASE_URL (real Postgres)
 *   - REDIS_URL (real Redis)
 *   - PAZZERA_WALLET_PROVIDER=local-dev
 *   - WALLET_MASTER_KEY, ARC_RPC_URL, USDC_CONTRACT_ADDRESS set
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('@pazzera/core/services/email-service', async () => {
  const actual = await vi.importActual<typeof import('@pazzera/core/services/email-service')>(
    '@pazzera/core/services/email-service',
  );
  return {
    ...actual,
    sendOtpEmail: async () => ({ delivered: true, provider: 'console' as const }),
  };
});

const { WalletService } = await import('../src/services/wallet-service');
const prisma = new PrismaClient();

const TEST_EMAIL = `wallet-test-${Date.now()}@pazzera-integration.test`;

describe('WalletService — provision + balance + transfer', () => {
  let userId = '';

  beforeAll(async () => {
    const { UserRepo } = await import('@pazzera/db/repositories');
    const { username } = await import('@pazzera/core/utils/username');
    const u = await UserRepo.create({ email: TEST_EMAIL, username: username.generateUsernameFromEmail(TEST_EMAIL) });
    userId = u.id;
  });

  afterAll(async () => {
    try {
      await prisma.ledgerEntry.deleteMany({ where: { fromUserId: userId } });
      await prisma.walletTransaction.deleteMany({ where: { wallet: { userId } } });
      await prisma.walletAnalytics.deleteMany({ where: { wallet: { userId } } });
      await prisma.walletRecovery.deleteMany({ where: { userId } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // ignore
    } finally {
      await prisma.$disconnect();
    }
  });

  it('provisions a wallet with v2 encryption', async () => {
    const result = await WalletService.provision(userId);
    expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(result.provider).toBe('local-dev');
    const wallet = await prisma.wallet.findUnique({ where: { id: result.walletId } });
    expect(wallet?.encryptionVersion).toBe(2);
    expect(wallet?.keyVersion).toBe(1);
    expect(wallet?.status).toBe('active');
    expect(wallet?.encryptedPrivateKey).toMatch(/"v":2/);
  });

  it('provisioning is idempotent', async () => {
    const first = await WalletService.provision(userId);
    const second = await WalletService.provision(userId);
    expect(first.walletId).toBe(second.walletId);
    expect(first.address).toBe(second.address);
  });

  it('reads balance and caches it', async () => {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet).toBeTruthy();
    const result = await WalletService.refreshBalance(wallet!.id);
    expect(result.balanceUsdc).toMatch(/^\d+\.\d+$/);
    const fresh = await prisma.wallet.findUnique({ where: { id: wallet!.id } });
    expect(fresh?.lastIndexedBlock).toBeTruthy();
  });

  it('rejects a withdraw when wallet is frozen', async () => {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    await prisma.wallet.update({
      where: { id: wallet!.id },
      data: { status: 'frozen', frozenAt: new Date(), frozenReason: 'test' },
    });
    await expect(
      WalletService.transfer({
        userId,
        walletId: wallet!.id,
        toAddress: '0x000000000000000000000000000000000000dEaD' as `0x${string}`,
        amountUsdc: '0.001',
        type: 'withdraw',
      }),
    ).rejects.toThrow(/frozen/);
    // restore
    await prisma.wallet.update({
      where: { id: wallet!.id },
      data: { status: 'active', frozenAt: null, frozenReason: null },
    });
  });

  it('rejects a withdraw above the daily cap', async () => {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    const huge = '9999999';
    await expect(
      WalletService.transfer({
        userId,
        walletId: wallet!.id,
        toAddress: '0x000000000000000000000000000000000000dEaD' as `0x${string}`,
        amountUsdc: huge,
        type: 'withdraw',
      }),
    ).rejects.toThrow(/cap|exceed/i);
  });
});