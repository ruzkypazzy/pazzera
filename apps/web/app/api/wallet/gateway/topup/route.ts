/**
 * POST /api/wallet/gateway/topup
 *
 * Move USDC from the listener's on-chain wallet into their Circle Gateway
 * Balance. Body: { amountUsdc: string }
 *
 * Two on-chain transactions via Circle DCW contractExecution:
 *   1. approve(GatewayWallet, amount) on USDC
 *   2. deposit(USDC, amount) on GatewayWallet
 *
 * The deposit CANNOT succeed until the approve is COMPLETE on-chain
 * (otherwise the Gateway contract sees allowance=0 and reverts). We poll
 * the approve tx until state === 'COMPLETE' before submitting the
 * deposit. Without this, on a slow block the deposit fails with
 * "missing approval" and the user has to click Top up 2-3 times.
 *
 * After both txs, the Gateway Balance credits when the Circle batch
 * settles (~13 minutes on testnet).
 */
import { z } from 'zod';
import {
  withApi,
  prisma,
  requireSession,
  getEnv,
  AppError,
  logger,
} from '@pazzera/core';
import { CircleRealProvider } from '@pazzera/blockchain/circle/real-provider';

const Body = z.object({
  amountUsdc: z.string().regex(/^\d+(\.\d+)?$/).refine((v) => parseFloat(v) > 0 && parseFloat(v) <= 1000, {
    message: 'amountUsdc must be > 0 and ≤ 1000',
  }),
});

const USDC_CONTRACT = '0x3600000000000000000000000000000000000000';
const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const body = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.message, 400);
    }
    const amountUsdc = parsed.data.amountUsdc;
    const amountBaseUnits = String(Math.floor(parseFloat(amountUsdc) * 1_000_000));

    const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not found', 404);
    if (wallet.provider !== 'circle-dcw' || !wallet.providerWalletId) {
      throw new AppError('FORBIDDEN', 'Only Circle DCW wallets can top up Gateway', 403);
    }
    if (parseFloat(wallet.balanceUsdc) < parseFloat(amountUsdc)) {
      throw new AppError(
        'CONFLICT',
        `Insufficient on-chain USDC: wallet has ${wallet.balanceUsdc}, requested ${amountUsdc}`,
        409,
      );
    }

    const env = getEnv();
    if (!env.CIRCLE_BASE_URL) {
      process.env.CIRCLE_BASE_URL = 'https://api.circle.com';
    }
    const provider = new CircleRealProvider();

    // 1. approve(GatewayWallet, amount) on USDC
    const approveRes = await provider.executeContract({
      walletId: wallet.providerWalletId,
      contractAddress: USDC_CONTRACT,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [GATEWAY_WALLET, amountBaseUnits],
      feeLevel: 'MEDIUM',
    });
    const approveTxId = approveRes?.data?.id;
    if (!approveTxId) {
      logger.warn({ userId: session.userId, approveRes }, 'gateway_topup:approve_no_id');
      throw new AppError('BAD_GATEWAY', 'Circle approve returned no tx id', 502);
    }
    logger.info(
      { userId: session.userId, approveTxId, amountUsdc },
      'gateway_topup:approve_submitted',
    );

    // Wait for approve to confirm on-chain before submitting deposit.
    let approveState: { state: string; txHash?: string };
    try {
      approveState = await provider.waitForTransaction(approveTxId, {
        maxAttempts: 60, // 60s — enough for Arc testnet blocks (~5s)
        pollIntervalMs: 2000,
      });
    } catch (err) {
      logger.warn(
        { userId: session.userId, approveTxId, err: String(err) },
        'gateway_topup:approve_did_not_confirm',
      );
      throw new AppError(
        'BAD_GATEWAY',
        `Approve transaction did not confirm in time. Circle tx ${approveTxId}. Please retry in a minute.`,
        504,
      );
    }
    logger.info(
      { userId: session.userId, approveTxId, state: approveState.state },
      'gateway_topup:approve_confirmed',
    );

    // 2. deposit(USDC, amount) on GatewayWallet
    const depositRes = await provider.executeContract({
      walletId: wallet.providerWalletId,
      contractAddress: GATEWAY_WALLET,
      abiFunctionSignature: 'deposit(address,uint256)',
      abiParameters: [USDC_CONTRACT, amountBaseUnits],
      feeLevel: 'MEDIUM',
    });
    const depositTxId = depositRes?.data?.id;
    if (!depositTxId) {
      logger.warn({ userId: session.userId, depositRes }, 'gateway_topup:deposit_no_id');
      throw new AppError('BAD_GATEWAY', 'Circle deposit returned no tx id', 502);
    }
    logger.info(
      { userId: session.userId, depositTxId, amountUsdc },
      'gateway_topup:deposit_submitted',
    );

    // Wait for deposit to confirm. If it fails, surface that to the
    // user so they know their USDC is still on-chain (we don't want
    // silent loss of funds).
    let depositState: { state: string; txHash?: string };
    try {
      depositState = await provider.waitForTransaction(depositTxId, {
        maxAttempts: 60,
        pollIntervalMs: 2000,
      });
    } catch (err) {
      logger.warn(
        { userId: session.userId, depositTxId, err: String(err) },
        'gateway_topup:deposit_did_not_confirm',
      );
      throw new AppError(
        'BAD_GATEWAY',
        `Deposit submitted but did not confirm in time. Circle tx ${depositTxId}. Check status later.`,
        504,
      );
    }
    logger.info(
      { userId: session.userId, depositTxId, state: depositState.state },
      'gateway_topup:deposit_confirmed',
    );

    // Mark throttle so the auto-deposit helper doesn't fire within 24h.
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { lastGatewayTopUpAt: new Date() },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        amountUsdc,
        approveTxId,
        approveTxHash: approveState.txHash,
        depositTxId,
        depositTxHash: depositState.txHash,
        note: 'Both txs confirmed. Gateway Balance credits ~13 min after Circle\'s next batch settles.',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { requireAuth: true, requireCsrf: true },
);