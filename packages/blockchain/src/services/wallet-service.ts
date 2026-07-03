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
import { CircleRealProvider } from '../circle/real-provider';
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
   *
   * The wallet is a Circle DCW (Developer-Controlled Wallet) — Circle
   * creates and owns the address + signing material. Pazzera never
   * holds the raw private key; we surface the address and basic
   * metadata to the user, and any signing happens server-side via
   * Circle APIs in the higher-level service code paths.
   *
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

    // DCW: address + walletId come from Circle only. No local keypair
    // generation, no mock provider — Circle is the source of truth.
    const circle = getCircleProvider();
    const circleResult = await circle.createWallet({
      userId,
      idempotencyKey: `pazzera:provision:${userId}`,
    });

    if (!circleResult.address) {
      throw new Error('Circle provider did not return an address');
    }

    const env = getEnv();
    const wallet = await prisma.wallet.create({
      data: {
        userId,
        address: circleResult.address,
        // No raw key in storage — Circle holds it. We store an empty
        // placeholder so any future code paths that try to decrypt will
        // fail loudly instead of silently using a wrong key.
        encryptedPrivateKey: '',
        encryptionVersion: 0,
        keyVersion: 0,
        provider: circle.name,
        providerWalletId: circleResult.walletId,
        custody: circleResult.custody, // 'platform' for DCW (Pazzera) or 'user' for UCW
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
        address: circleResult.address,
        provider: circle.name,
        circleWalletId: circleResult.walletId,
        custody: circleResult.custody,
      },
      'wallet:provisioned',
    );

    return {
      walletId: wallet.id,
      address: circleResult.address,
      provider: circle.name,
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
      // DCW (real Circle developer-controlled): Pazzera signs server-side
      // through Circle's prepareTransfer / submitTransfer API. The
      // entitySecretCiphertext is set per request; the resulting
      // settlement happens on-chain. x402 + DCW both work the same
      // way from a user-perspective — the platform controls the
      // signing keys via the entity secret.
      if (wallet.provider === 'circle-dcw' || wallet.provider === 'circle-ucw' || wallet.provider === 'circle-mock') {
        const circle = getCircleProvider();
        const prepared = await circle.prepareTransfer({
          walletId: wallet.providerWalletId,
          destination: { kind: 'address', value: opts.toAddress },
          amountBaseUnits,
          network: 'ARC-TESTNET',
          memo: opts.memo,
        });
        // The mock's prepareTransfer already returns a `transferId`;
        // the real DCW flow submits via submitTransfer (idempotent).
        const settled = (prepared as { transferId?: string }).transferId
          ? await circle.submitTransfer((prepared as { transferId: string }).transferId)
          : prepared;
        await prisma.walletTransaction.update({
          where: { id: tx.id },
          data: {
            status: 'confirmed',
            txHash: (settled as { txHash?: string }).txHash ?? null,
            submittedAt: new Date(),
            confirmedAt: new Date(),
          },
        });
        await incrementWalletAnalyticsSpend(wallet.id, amountBaseUnits);
        return {
          txHash: (settled as { txHash?: string }).txHash ?? null,
          blockNumber: 0,
          status: 'confirmed',
        };
      }

      // Legacy local-dev path: Pazzera held the encrypted key.
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
        await incrementWalletAnalyticsSpend(wallet.id, amountBaseUnits);
        return { txHash: r.txHash, blockNumber: r.blockNumber, status: r.status };
      }

      // Shouldn't get here in normal operation, but if we do, surface
      // a clear error instead of crashing.
      throw new AppError(
        'PAYMENT_FAILED',
        'No signing path available for this wallet provider.',
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
    /**
     * EIP-712 scheme variant:
     *   - 'usdc-facet' (default) — standard USDC EIP-3009 with
     *     domain { name:'USDC', version:'2', verifyingContract:USDC }.
     *     For Coinbase / x.org facilitator.
     *   - 'gateway-batched' — Circle Gateway batching scheme with
     *     domain { name:'GatewayWalletBatched', version:'1',
     *     verifyingContract:Gateway Wallet }.
     *     For Circle Gateway /v1/x402/settle batched flow.
     */
    scheme?: 'usdc-facet' | 'gateway-batched';
  }): Promise<{ v: number; r: Hex; s: Hex; platformSigned: boolean }> {
    const wallet = await prisma.wallet.findUnique({ where: { id: opts.walletId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not found', 404);
    if (wallet.userId !== opts.userId) throw new AppError('FORBIDDEN', 'Wallet mismatch', 403);
    if (wallet.status !== 'active') {
      throw new AppError('FORBIDDEN', `Wallet is ${wallet.status}`, 403);
    }
    if (!wallet.encryptedPrivateKey && wallet.provider !== 'circle-dcw' && wallet.provider !== 'circle-ucw') {
      throw new AppError('FORBIDDEN', 'Wallet has no signing material', 403);
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

    // DCW + UCW: ask Circle to sign the EIP-712 typed data. Circle
    // holds the keys, the platform passes the typed data + entity
    // secret and Circle returns the signature.
    if (wallet.provider === 'circle-dcw' || wallet.provider === 'circle-ucw') {
      const circle = getCircleProvider();
      const scheme = opts.scheme ?? 'usdc-facet';
      // EIP-712 domain depends on the settlement scheme.
      //  - usdc-facet: domain={name:'USDC', version:'2', verifyingContract:USDC}
      //  - gateway-batched: domain={name:'GatewayWalletBatched', version:'1',
      //    verifyingContract: Gateway Wallet}
      const domain =
        scheme === 'gateway-batched'
          ? {
              name: 'GatewayWalletBatched',
              version: '1',
              chainId: opts.chainId,
              verifyingContract: ('0x0077777d7EBA4688BDeF3E311b846F25870A19B9') as Address,
            }
          : {
              name: 'USDC',
              version: '2',
              chainId: opts.chainId,
              verifyingContract: opts.usdcContract,
            };
      const sig = await (circle as CircleRealProvider).signTypedData({
        walletId: wallet.providerWalletId,
        typedData: {
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            TransferWithAuthorization: [
              { name: 'from', type: 'address' },
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'validAfter', type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
              { name: 'nonce', type: 'bytes32' },
            ],
          },
          primaryType: 'TransferWithAuthorization',
          domain,
          message: {
            from: wallet.address as Address,
            to: opts.to,
            value: opts.valueBaseUnits,
            validAfter: opts.validAfter,
            validBefore: opts.validBefore,
            nonce: opts.nonce,
          },
      } });
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: { x402AuthorizedAt: new Date() },
      });
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
      return {
        v: (sig as { v?: number }).v ?? 0,
        r: ((sig as { r?: Hex }).r ?? '0x') as Hex,
        s: ((sig as { s?: Hex }).s ?? '0x') as Hex,
        platformSigned: true,
      };
    }

    // Legacy local-dev path: Pazzera held the encrypted key.
    const sig = await signAuthorizationFor(wallet.userId, wallet.encryptedPrivateKey!, opts);
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