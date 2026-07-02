/**
 * Wipe all local-dev wallets and re-provision them as Circle DCW.
 *
 * The previous reprovision-wallets.ts run produced random local
 * addresses, which the user explicitly does NOT want. They want all
 * addresses to come from Circle. This script:
 *
 *   1. Deletes every Wallet row + their WalletTransaction,
 *      WalletAnalytics, and related LedgerEntry rows.
 *   2. Calls WalletService.provision() with the new DCW-only code
 *      so each address comes from Circle (real or mock).
 *
 * Idempotent. Doesn't touch any Song or Stream rows.
 */
import { WalletService } from '@pazzera/blockchain';
import { prisma } from '@pazzera/core';

async function main() {
  const wallets = await prisma.wallet.findMany({ select: { id: true, userId: true, address: true } });
  console.log(`[migrate-to-dcw] Wiping ${wallets.length} wallet(s)...`);

  for (const w of wallets) {
    await prisma.walletTransaction.deleteMany({ where: { walletId: w.id } });
    await prisma.walletAnalytics.deleteMany({ where: { walletId: w.id } });
    await prisma.ledgerEntry.deleteMany({
      where: { OR: [{ fromWalletId: w.id }, { toWalletId: w.id }] },
    });
    await prisma.wallet.delete({ where: { id: w.id } });
  }

  const users = await prisma.user.findMany({ select: { id: true, email: true }, orderBy: { createdAt: 'asc' } });
  let ok = 0;
  let failed = 0;
  for (const u of users) {
    try {
      const r = await WalletService.provision(u.id);
      const fresh = await prisma.wallet.findUnique({ where: { id: r.walletId } });
      console.log(
        `  ✓ ${u.email}: → ${fresh?.address}  [provider=${fresh?.provider}, custody=${fresh?.custody}]`,
      );
      ok += 1;
    } catch (err) {
      console.error(`  ✗ ${u.email}: ${(err as Error).message}`);
      failed += 1;
    }
  }

  console.log(`[migrate-to-dcw] Done. ok=${ok}, failed=${failed}.`);
}

main()
  .catch((err) => {
    console.error('[migrate-to-dcw] Fatal:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });