/**
 * POST /api/wallet/gateway/topup
 *
 * Move USDC from the listener's on-chain wallet into their Circle Gateway
 * Balance. Body: { amountUsdc: string }
 *
 * Two on-chain transactions (Circle DCW contract execution):
 *   1. approve(GatewayWallet, amount) on USDC
 *   2. deposit(USDC, amount) on GatewayWallet
 *
 * Gateway Balance credits ~13-19 minutes later. The Fan Agent also
 * auto-tops up before settling, so manual top-ups are optional.
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
const ARC_TESTNET = 'ARC-TESTNET';

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
    const baseUrl = env.CIRCLE_BASE_URL || 'https://api.circle.com';
    const apiKey = env.CIRCLE_API_KEY;
    const entitySecret = env.CIRCLE_ENTITY_SECRET;

    // Helper: encrypt entity secret with Circle's RSA public key.
    // (same as deposit-to-gateway.ts; we do it inline because the
    // provider's request() helper isn't a pure function.)
    const forge: any = require('node-forge');
    const pubRes = await fetch(`${baseUrl}/v1/w3s/config/entity/publicKey`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pubRes.ok) {
      throw new AppError('BAD_GATEWAY', 'Failed to fetch Circle public key', 502);
    }
    const pubJson: any = await pubRes.json();
    const publicKey = forge.pki.publicKeyFromPem(pubJson.data.publicKey);
    const bytes = forge.util.hexToBytes(entitySecret);
    const encrypted = publicKey.encrypt(bytes, 'RSA-OAEP', {
      md: forge.md.sha256.create(),
      mgf1: { md: forge.md.sha256.create() },
    });
    const entitySecretCiphertext = forge.util.encode64(encrypted);

    const idempotencyKey = (require('node:crypto') as typeof import('node:crypto')).randomUUID();

    // Step 1: approve Gateway to spend USDC.
    const approveBody = {
      idempotencyKey,
      walletId: wallet.providerWalletId,
      contractAddress: USDC_CONTRACT,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [GATEWAY_WALLET, amountBaseUnits],
      feeLevel: 'MEDIUM',
      blockchain: ARC_TESTNET,
      entitySecretCiphertext,
    };
    const approveRes = await fetch(`${baseUrl}/v1/w3s/developer/transactions/contractExecution`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(approveBody),
    });
    const approveJson: any = await approveRes.json();
    if (!approveJson?.data?.id) {
      logger.warn({ userId: session.userId, approveJson }, 'gateway_topup:approve_failed');
      throw new AppError('BAD_GATEWAY', `Approve failed: ${JSON.stringify(approveJson)}`, 502);
    }
    logger.info(
      { userId: session.userId, approveTxId: approveJson.data.id, amountUsdc },
      'gateway_topup:approve_submitted',
    );

    // Step 2: deposit. The approve needs ~10s to mine on Arc testnet.
    // We wait synchronously to make this endpoint idempotent enough
    // for the user to retry the page; in production you'd queue this
    // and poll for completion.
    await new Promise((r) => setTimeout(r, 10_000));

    const depositKey = (require('node:crypto') as typeof import('node:crypto')).randomUUID();
    const depositBody = {
      idempotencyKey: depositKey,
      walletId: wallet.providerWalletId,
      contractAddress: GATEWAY_WALLET,
      abiFunctionSignature: 'deposit(address,uint256)',
      abiParameters: [USDC_CONTRACT, amountBaseUnits],
      feeLevel: 'MEDIUM',
      blockchain: ARC_TESTNET,
      entitySecretCiphertext,
    };
    const depositRes = await fetch(`${baseUrl}/v1/w3s/developer/transactions/contractExecution`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(depositBody),
    });
    const depositJson: any = await depositRes.json();
    if (!depositJson?.data?.id) {
      logger.warn({ userId: session.userId, depositJson }, 'gateway_topup:deposit_failed');
      throw new AppError('BAD_GATEWAY', `Deposit failed: ${JSON.stringify(depositJson)}`, 502);
    }
    logger.info(
      { userId: session.userId, depositTxId: depositJson.data.id, amountUsdc },
      'gateway_topup:deposit_submitted',
    );

    // Mark cooldown so auto-deposit doesn't repeat.
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { lastGatewayTopUpAt: new Date() },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        amountUsdc,
        approveTxId: approveJson.data.id,
        depositTxId: depositJson.data.id,
        note: 'Gateway Balance credits ~13 minutes after the deposit mines. Reload then.',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { requireAuth: true, requireCsrf: true },
);

// Suppress unused import warning (kept for documentation / future use).
void CircleRealProvider;