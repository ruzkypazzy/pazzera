/**
 * Backfill wallets for users created during the period when the worker
 * process was crashing/restart-looping and never actually invoked
 * `WalletService.provision()`.
 *
 * Idempotent: skips users who already have a Wallet row.
 *
 * Usage:
 *   cd /opt/pazzera
 *   pnpm --filter @pazzera/blockchain run backfill-wallets
 *     # or via tsx:
 *   tsx /opt/pazzera/scripts/backfill-wallets.ts
 */
import { WalletService } from '@pazzera/blockchain';
import { prisma } from '@pazzera/db';

async function main() {
  const usersWithoutWallet = await prisma.user.findMany({
    where: {
      wallet: { is: null },
    },
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(
    `[backfill-wallets] Found ${usersWithoutWallet.length} user(s) without a wallet.`,
  );
  if (usersWithoutWallet.length === 0) {
    console.log('[backfill-wallets] Nothing to do. Exiting.');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const u of usersWithoutWallet) {
    try {
      const result = await WalletService.provision(u.id);
      ok += 1;
      console.log(
        `[backfill-wallets]   ✓ ${u.email} (${u.id}) → ${result.address.slice(0, 6)}…${result.address.slice(-4)}  [${result.provider}]`,
      );
    } catch (err) {
      failed += 1;
      console.error(
        `[backfill-wallets]   ✗ ${u.email} (${u.id}): ${(err as Error).message}`,
      );
    }
  }

  console.log(`[backfill-wallets] Done. ok=${ok}, failed=${failed}.`);
}

main()
  .catch((err) => {
    console.error('[backfill-wallets] Fatal:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });