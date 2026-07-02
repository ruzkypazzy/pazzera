/**
 * WalletService — the single entry point for wallet operations.
 *
 *   1. Picks the active provider (Circle UCW in prod, LocalDev in dev)
 *   2. Persists state in the DB (Wallet + WalletTransaction + WalletAnalytics)
 *   3. Enforces withdrawal caps, cooldowns, fraud signals
 *   4. Coordinates with the indexer for balance refresh
 *
 * All amounts handled in USDC base units (BigInt as string).
 */
import { prisma } from '@pazzera/db';
import { sumStrings } from '@pazzera/db/utils/big-arith';
import { logger, getEnv, AppError, BlockchainError } from '@pazzera/core';
import { getWalletProvider } from '../wallets/factory';
import { signAuthorizationFor, transferFor } from '../wallets/local-dev-provider';
import { usdcToBaseUnits, baseUnitsToUsdc } from '../adapters/usdc';

/**
 * Bump `totalSpendBaseUnits` by `delta` (string base-units). `String!`
 * columns can't be updated with Prisma's typed `increment` shorthand, so
 * we read the current value, run bigint arithmetic, then write back.
 */
async function incrementWalletAnalyticsSpend(walletId: string, delta: string): Promise<void> {
  const existing = await prisma.walletAnalytics.findUnique({
    where: { walletId },
    select: { totalSpendBaseUnits: true },
  });
  const newTotal = (sumStrings([{ totalSpendBaseUnits: existing?.totalSpendBaseUnits ?? '0' }], 'totalSpendBaseUnits') + BigInt(delta)).toString();
  await prisma.walletAnalytics.upsert({
    where: { walletId },
    create: { walletId, totalSpendBaseUnits: newTotal, lastSpendAt: new Date() },
    update: { totalSpendBaseUnits: newTotal, lastSpendAt: new Date() },
  });
}
import { getActiveProvider as getCircleProvider, CircleMockProvider } from '../circle/factory';
import type { Address, Hex } from 'viem';

export class WalletService {
  /**
   * Provision a wallet for a user. Idempotent.
   * Returns the active Wallet row.
   */
  static async provision(userId: string): Promise<{
    walletId: string;
    address: string;
    provider: string;
    custody: string;
  }> {
    const existing = await prisma.wallet.findUnique({ where: { userId } });
    if (existing) {
      return {
        walletId: existing.id,
        address: existing.address,
        provider: existing.provider,
        custody: existing.custody,
      };
    }

    const localProvider = getWalletProvider();
    const localResult = await localProvider.createWallet({ userId });

    // Phase 9 — also provision through the active Circle provider (real or
    // mock). This is what gives us the canonical providerWalletId +
    // providerMetadata for the admin dashboard + Circle webhooks.
    const circle = getCircleProvider();
    const circleResult = await circle.createWallet({
      userId,
      idempotencyKey: `pazzera:provision:${userId}`,
    });

    // Provider name resolution: prefer the legacy `provider.name` shape,
    // except when running on the real UCW adapter.
    const activeProviderName =
      circle.name === 'circle-ucw'
        ? 'circle-ucw'
        : (localResult.providerWalletId.startsWith('local-') ? 'local-dev' : localProvider.name);

    // Address resolution: the on-chain address stored on the wallet MUST
    // match the address the user can derive from the encrypted key we hand
    // them via /api/wallet/export. We hold the local key, so the address is
    // the local provider's address. The Circle adapter is only the source
    // of providerWalletId / custody metadata.
    //
    // In Circle UCW mode (real), the platform never sees the key — Circle
    // holds it — so the Circle address is the truth. Switch on that case.
    const activeAddress =
      circle.name === 'circle-ucw'
        ? (circleResult.address ?? localResult.address)
        : localResult.address;

    const env = getEnv();
    const wallet = await prisma.wallet.create({
      data: {
        userId,
        address: activeAddress,
        encryptedPrivateKey: localResult.encryptedSecret ?? '',
        encryptionVersion: 2,
        keyVersion: 1,
        provider: activeProviderName,
        providerWalletId: circleResult.walletId, // canonical Circle id
        custody: circleResult.custody,
        status: 'active',
        balanceUsdc: '0',
        pendingUsdc: '0',
        x402DailyCapUsdc: env.WALLET_X402_DAILY_CAP_USDC.toString(),
        x402PerStreamCapUsdc: env.WALLET_X402_PER_STREAM_CAP_USDC.toString(),
      },
    });

    await prisma.walletAnalytics.create({
      data: { walletId: wallet.id },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'adjustment',
        direction: 'credit',
        amountUsdc: '0',
        amountBaseUnits: '0',
        status: 'confirmed',
        confirmedAt: new Date(),
        memo: 'Wallet provisioned',
      },
    });

    logger.info(
      {
        userId,
        walletId: wallet.id,
        address: circleResult.address ?? localResult.address,
        provider: activeProviderName,
        circleWalletId: circleResult.walletId,
      },
      'wallet:provisioned',
    );

    return {
      walletId: wallet.id,
      address: circleResult.address ?? localResult.address,
      provider: activeProviderName,
      custody: circleResult.custody,
    };
  }

  /**
   * Read on-chain USDC balance via the active provider.
   * Caches into Wallet.balanceUsdc after a successful read.
   */
  static async refreshBalance(walletId: string): Promise<{ balanceUsdc: string; blockNumber: number }> {
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not found', 404);
    // Prefer the Circle adapter for balance reads — it returns a richer
    // shape (blockNumber, chainId, formatting) and stays consistent with
    // the same source that provisioned the wallet.
    try {
      const circle = getCircleProvider();
      const cb = wallet.providerWalletId
        ? await circle.fetchBalance(wallet.providerWalletId)
        : await circle.fetchBalance(wallet.address);
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          balanceUsdc: cb.balanceUsdc,
          lastIndexedBlock: BigInt(cb.blockNumber),
        },
      });
      return { balanceUsdc: cb.balanceUsdc, blockNumber: cb.blockNumber };
    } catch {
      // Fallback to legacy read path (LocalDev RPC).
      const provider = getWalletProvider();
      const result = await provider.getBalance(wallet.address);
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          balanceUsdc: result.balanceUsdc,
          lastIndexedBlock: BigInt(result.blockNumber),
        },
      });
      return { balanceUsdc: result.balanceUsdc, blockNumber: result.blockNumber };
    }
  }

  /**
   * Submit a USDC transfer (withdraw or payout).
   * Enforces:
   *   - Wallet status check
   *   - Daily withdrawal cap
   *   - Withdraw cooldown (configurable)
   *   - Frozen / compromised wallet block
   */
  static async transfer(opts: {
    userId: string;
    walletId: string;
    toAddress: Address;
    amountUsdc: string;
    memo?: string;
    type?: 'withdraw' | 'royalty_payout' | 'refund' | 'adjustment';
  }): Promise<{ txHash: string; blockNumber: number; status: string }> {
    const env = getEnv();
    const wallet = await prisma.wallet.findUnique({ where: { id: opts.walletId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not found', 404);
    if (wallet.userId !== opts.userId) {
      throw new AppError('FORBIDDEN', 'Wallet does not belong to user', 403);
    }
    if (wallet.status === 'frozen' || wallet.status === 'compromised') {
      throw new AppError('FORBIDDEN', `Wallet is ${wallet.status}`, 403);
    }
    if (wallet.status === 'recovery_requested') {
      throw new AppError('FORBIDDEN', 'Wallet is in recovery; cannot transfer', 403);
    }

    // Daily cap check (for user-initiated withdraws only)
    if (opts.type === 'withdraw') {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const last24hRows = await prisma.walletTransaction.findMany({
        where: {
          walletId: wallet.id,
          type: 'withdraw',
          status: { in: ['confirmed'] },
          confirmedAt: { gte: since24h },
        },
        select: { amountBaseUnits: true },
      });
      const last24h = sumStrings(last24hRows, 'amountBaseUnits');
      const amount = usdcToBaseUnits(opts.amountUsdc);
      const cap = usdcToBaseUnits(env.WALLET_DAILY_WITHDRAW_CAP_USDC.toString());
      if (last24h + amount > cap) {
        throw new AppError('CONFLICT', 'Daily withdrawal cap exceeded', 409, {
          capUsdc: baseUnitsToUsdc(cap.toString()),
          usedUsdc: baseUnitsToUsdc(last24h.toString()),
          requestedUsdc: opts.amountUsdc,
        });
      }

      // Cooldown: must wait N seconds between withdraws
      const last = await prisma.walletTransaction.findFirst({
        where: { walletId: wallet.id, type: 'withdraw', status: { in: ['confirmed', 'submitted'] } },
        orderBy: { confirmedAt: 'desc' },
      });
      if (last?.confirmedAt) {
        const elapsed = (Date.now() - last.confirmedAt.getTime()) / 1000;
        if (elapsed < env.WALLET_WITHDRAW_COOLDOWN_SECONDS) {
          throw new AppError('RATE_LIMITED', `Withdraw cooldown active`, 429, {
            retryAfterSec: Math.ceil(env.WALLET_WITHDRAW_COOLDOWN_SECONDS - elapsed),
          });
        }
      }
    }

    // Write pending transaction
    const amountBaseUnits = usdcToBaseUnits(opts.amountUsdc).toString();
    const tx = await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: opts.type ?? 'withdraw',
        direction: 'debit',
        amountUsdc: opts.amountUsdc,
        amountBaseUnits,
        status: 'pending',
        counterpartyAddress: opts.toAddress,
        memo: opts.memo,
      },
    });

    try {
      // UCW path: this throws (intentionally — UCW signs client-side)
      // LocalDev path: this signs + submits using the encrypted key
      if (wallet.provider === 'local-dev' && wallet.encryptedPrivateKey) {
        await prisma.walletTransaction.update({
          where: { id: tx.id },
          data: { status: 'signed', signedAt: new Date() },
        });
        const r = await transferFor(wallet.userId, wallet.encryptedPrivateKey, {
          fromAddress: wallet.address as Address,
          toAddress: opts.toAddress,
          amountBaseUnits,
          submit: true,
          memo: opts.memo,
        });
        await prisma.walletTransaction.update({
          where: { id: tx.id },
          data: {
            status: r.status,
            txHash: r.txHash,
            blockNumber: BigInt(r.blockNumber),
            submittedAt: new Date(),
            confirmedAt: r.status === 'confirmed' ? new Date() : null,
            failedAt: r.status === 'failed' ? new Date() : null,
            failureReason: r.status === 'failed' ? 'tx_reverted' : null,
          },
        });
        // Bump analytics
        await incrementWalletAnalyticsSpend(wallet.id, amountBaseUnits);
        return { txHash: r.txHash, blockNumber: r.blockNumber, status: r.status };
      }

      // UCW: client must sign. Return pending + a challenge token.
      throw new AppError(
        'PAYMENT_FAILED',
        'User-controlled wallet requires client-side signing (x402). Use the x402 flow.',
        402,
      );
    } catch (err) {
      if (err instanceof AppError) {
        if (err.code !== 'PAYMENT_FAILED') {
          await prisma.walletTransaction.update({
            where: { id: tx.id },
            data: { status: 'failed', failedAt: new Date(), failureReason: err.message },
          });
        }
        throw err;
      }
      await prisma.walletTransaction.update({
        where: { id: tx.id },
        data: {
          status: 'failed',
          failedAt: new Date(),
          failureReason: err instanceof Error ? err.message : String(err),
        },
      });
      throw new BlockchainError('Transfer failed', {
        txId: tx.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Build the EIP-712 authorization signature for x402 nano payments.
   * Only works in local-dev mode today (UCW signs client-side).
   */
  static async signX402Authorization(opts: {
    userId: string;
    walletId: string;
    to: Address;
    valueBaseUnits: string;
    validAfter: number;
    validBefore: number;
    nonce: Hex;
    chainId: number;
    usdcContract: Address;
  }): Promise<{ v: number; r: Hex; s: Hex; platformSigned: boolean }> {
    const wallet = await prisma.wallet.findUnique({ where: { id: opts.walletId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not found', 404);
    if (wallet.userId !== opts.userId) throw new AppError('FORBIDDEN', 'Wallet mismatch', 403);
    if (wallet.status !== 'active') {
      throw new AppError('FORBIDDEN', `Wallet is ${wallet.status}`, 403);
    }
    if (!wallet.encryptedPrivateKey) {
      throw new AppError('FORBIDDEN', 'UCW wallets must sign client-side', 403);
    }

    // Per-stream + daily x402 caps
    const env = getEnv();
    const requestedValue = BigInt(opts.valueBaseUnits);
    const perStreamCap = usdcToBaseUnits((wallet.x402PerStreamCapUsdc ?? env.WALLET_X402_PER_STREAM_CAP_USDC.toString()).toString());
    const dailyCap = usdcToBaseUnits((wallet.x402DailyCapUsdc ?? env.WALLET_X402_DAILY_CAP_USDC.toString()).toString());
    if (requestedValue > perStreamCap) {
      throw new AppError('CONFLICT', 'Per-stream x402 cap exceeded', 409, {
        capBaseUnits: perStreamCap.toString(),
      });
    }
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24hRows = await prisma.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type: 'x402_settlement',
        status: { in: ['confirmed', 'submitted'] },
        confirmedAt: { gte: since24h },
      },
      select: { amountBaseUnits: true },
    });
    const used = sumStrings(last24hRows, 'amountBaseUnits');
    if (used + requestedValue > dailyCap) {
      throw new AppError('CONFLICT', 'Daily x402 cap exceeded', 409, {
        capBaseUnits: dailyCap.toString(),
        usedBaseUnits: used.toString(),
      });
    }

    const sig = await signAuthorizationFor(wallet.userId, wallet.encryptedPrivateKey, opts);
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { x402AuthorizedAt: new Date() },
    });
    // Write a pending x402_settlement row so daily-cap is counted once confirmed
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'x402_settlement',
        direction: 'debit',
        amountUsdc: baseUnitsToUsdc(opts.valueBaseUnits),
        amountBaseUnits: opts.valueBaseUnits,
        status: 'signed',
        signedAt: new Date(),
        counterpartyAddress: opts.to,
        memo: 'x402 nano payment (pre-settlement)',
      },
    });
    return { v: sig.v, r: sig.r, s: sig.s, platformSigned: sig.platformSigned };
  }
}