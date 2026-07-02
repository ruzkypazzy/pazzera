/**
 * Re-provision wallets so the stored address actually derives from the
 * stored encrypted private key.
 *
 * Background: in the previous backfill we set `address` from the
 * Circle mock (which derives a deterministic address from userId) and
 * `encryptedPrivateKey` from the local-dev provider (a random keypair).
 * The two were unrelated, so exporting the key and pasting into
 * MetaMask produced a different address than what the wallet page
 * showed. This script:
 *
 *   1. Deletes the existing Wallet row + related WalletAnalytics /
 *      WalletTransaction rows for each user
 *   2. Calls WalletService.provision(userId) so a fresh local-dev
 *      keypair is generated, encrypted, and stored with the matching
 *      address.
 *
 * Idempotent: running twice produces the same final state (the second
 * run just creates a second wallet and replaces the first, which
 * brings the same address since local-dev uses a fresh random keypair
 * each call — actually no, each call generates a NEW keypair, so
 * don't run twice).
 *
 * Usage:
 *   cd /opt/pazzera
 *   pnpm tsx scripts/reprovision-wallets.ts
 */
import { WalletService, decryptAndMigrate } from '@pazzera/blockchain';
import { privateKeyToAccount } from 'viem/accounts';
import { prisma } from '@pazzera/core';

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, wallet: { select: { id: true, address: true, encryptedPrivateKey: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[reprovision-wallets] Checking ${users.length} user(s)...`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const u of users) {
    if (u.wallet) {
      // Verify the stored address matches the address the stored key derives to.
      try {
        const { key } = decryptAndMigrate(u.id, u.wallet.encryptedPrivateKey!);
        const acct = privateKeyToAccount(key as `0x${string}`);
        if (acct.address.toLowerCase() === u.wallet.address.toLowerCase()) {
          console.log(`  ✓ ${u.email}: already correct (${u.wallet.address.slice(0, 10)}…)`);
          skipped += 1;
          continue;
        }
      } catch {
        // fall through to reprovision
      }
      console.log(
        `  ↻ ${u.email}: stored address ${u.wallet.address.slice(0, 10)}… doesn't match the encrypted key — reprovisioning`,
      );
      // Delete related rows first (FK constraint), then the wallet.
      await prisma.walletTransaction.deleteMany({ where: { walletId: u.wallet.id } });
      await prisma.walletAnalytics.deleteMany({ where: { walletId: u.wallet.id } });
      await prisma.ledgerEntry.deleteMany({ where: { OR: [{ fromWalletId: u.wallet.id }, { toWalletId: u.wallet.id }] } });
      await prisma.wallet.delete({ where: { id: u.wallet.id } });
    }

    try {
      const result = await WalletService.provision(u.id);
      // Round-trip verify
      const fresh = await prisma.wallet.findUnique({ where: { id: result.walletId } });
      if (fresh) {
        const { key } = decryptAndMigrate(u.id, fresh.encryptedPrivateKey!);
        const acct = privateKeyToAccount(key as `0x${string}`);
        const match = acct.address.toLowerCase() === fresh.address.toLowerCase();
        console.log(
          `  ✓ ${u.email}: → ${fresh.address.slice(0, 10)}…${fresh.address.slice(-6)}  [${match ? 'KEY↔ADDRESS OK' : 'MISMATCH!!'}]`,
        );
        if (match) ok += 1;
        else failed += 1;
      } else {
        console.log(`  ✗ ${u.email}: provision returned walletId but no row found`);
        failed += 1;
      }
    } catch (err) {
      console.error(`  ✗ ${u.email}: ${(err as Error).message}`);
      failed += 1;
    }
  }

  console.log(`[reprovision-wallets] Done. reprovisioned=${ok}, already-correct=${skipped}, failed=${failed}.`);
}

main()
  .catch((err) => {
    console.error('[reprovision-wallets] Fatal:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });