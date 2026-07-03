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
 * Gateway Balance credits ~13 minutes after both txs mine.
 * The Fan Agent also auto-tops up before settling, so manual top-ups
 * are optional — this endpoint is for users who want to fund upfront.
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
    // Ensure CIRCLE_BASE_URL is set so CircleRealProvider reads it.
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
        depositTxId,
        note: 'Both txs submitted. Gateway Balance credits ~13 min after both mine.',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { requireAuth: true, requireCsrf: true },
);