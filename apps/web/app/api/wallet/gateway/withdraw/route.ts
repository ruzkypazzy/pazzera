/**
 * POST /api/wallet/gateway/withdraw
 *
 * Move USDC from the user's Circle Gateway Balance back to their on-chain
 * wallet. Body: { amountUsdc: string }
 *
 * Two on-chain transactions:
 *   1. Circle Gateway burn-intent (signed by the user's DCW via Circle API)
 *   2. Circle Gateway minter settles the attestation on-chain
 *
 * Same-chain withdrawals are instant; cross-chain settle when the
 * destination batch closes (minutes to hours on testnet).
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

const Body = z.object({
  // Indie-artist withdrawals: any amount from 1 USDC upwards, no
  // daily cap. Independent artists should be able to drain their
  // full Gateway Balance in one shot when they want to off-ramp
  // their earnings. The Circle Gateway balance check below still
  // prevents over-withdraw.
  amountUsdc: z.string().regex(/^\d+(\.\d+)?$/).refine((v) => parseFloat(v) >= 1, {
    message: 'amountUsdc must be ≥ 1',
  }),
});

const USDC_CONTRACT = '0x3600000000000000000000000000000000000000';
const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
const GATEWAY_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';
const ARC_DOMAIN = 26;

async function fetchGatewayBalance(
  apiKey: string,
  gatewayUrl: string,
  address: string,
): Promise<string> {
  const r = await fetch(`${gatewayUrl}/v1/balances`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: [{ depositor: address, domain: ARC_DOMAIN }],
    }),
  });
  if (!r.ok) throw new AppError('BAD_GATEWAY', `Gateway balance query failed: ${r.status}`, 502);
  const j: any = await r.json();
  return j?.balances?.[0]?.balance ?? '0';
}

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const body = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.message, 400);
    }
    const amountUsdc = parsed.data.amountUsdc;
    const amountBaseUnits = BigInt(Math.floor(parseFloat(amountUsdc) * 1_000_000));

    const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not found', 404);
    if (wallet.provider !== 'circle-dcw' || !wallet.providerWalletId) {
      throw new AppError('FORBIDDEN', 'Only Circle DCW wallets can withdraw from Gateway', 403);
    }

    const env = getEnv();
    const apiKey = env.CIRCLE_API_KEY;
    const gatewayUrl = env.CIRCLE_GATEWAY_FACILITATOR_URL || 'https://gateway-api-testnet.circle.com';

    // Check available balance.
    const balanceStr = await fetchGatewayBalance(apiKey, gatewayUrl, wallet.address);
    const balanceBaseUnits = BigInt(Math.floor(parseFloat(balanceStr) * 1_000_000));
    if (balanceBaseUnits < amountBaseUnits) {
      throw new AppError(
        'CONFLICT',
        `Insufficient Gateway Balance: have ${balanceStr} USDC, requested ${amountUsdc}`,
        409,
      );
    }

    // Build the burn-intent. Same-chain withdraw (Arc → Arc).
    const now = Math.floor(Date.now() / 1000);
    const salt = ('0x' + (require('node:crypto') as typeof import('node:crypto')).randomBytes(32).toString('hex')) as `0x${string}`;

    const burnIntent = {
      maxBlockHeight: BigInt(now + 30 * 60).toString(), // 30 min window
      maxFee: '20000', // 0.02 USDC max fee
      spec: {
        version: 1,
        sourceDomain: ARC_DOMAIN,
        destinationDomain: ARC_DOMAIN,
        sourceContract: GATEWAY_WALLET,
        destinationContract: GATEWAY_MINTER,
        sourceToken: USDC_CONTRACT,
        destinationToken: USDC_CONTRACT,
        sourceDepositor: wallet.address,
        destinationRecipient: wallet.address,
        sourceSigner: wallet.address,
        destinationCaller: '0x0000000000000000000000000000000000000000',
        value: amountBaseUnits.toString(),
        salt,
        hookData: '0x',
      },
    };

    // Sign the burn-intent. We use a dedicated signer (NOT
    // signX402Authorization) because:
    //   - The typed-data envelope is the Gateway's BurnIntent struct,
    //     not x402 TransferWithAuthorization.
    //   - The per-stream + daily x402 caps (0.01 USDC / 5 USDC) do not
    //     apply to a burn-intent — it's the user moving their own
    //     Gateway Balance, not a stream payment.
    const { WalletService } = await import('@pazzera/blockchain');
    const signed = await WalletService.signGatewayBurnIntent({
      userId: session.userId,
      walletId: wallet.id,
      chainId: Number(env.ARC_CHAIN_ID),
      burnIntent: {
        maxBlockHeight: BigInt(now + 30 * 60).toString(),
        maxFee: '20000',
        spec: {
          version: 1,
          sourceDomain: ARC_DOMAIN,
          destinationDomain: ARC_DOMAIN,
          sourceContract: GATEWAY_WALLET,
          destinationContract: GATEWAY_MINTER,
          sourceToken: USDC_CONTRACT,
          destinationToken: USDC_CONTRACT,
          sourceDepositor: wallet.address,
          destinationRecipient: wallet.address,
          sourceSigner: wallet.address,
          destinationCaller: '0x0000000000000000000000000000000000000000',
          value: amountBaseUnits.toString(),
          salt,
          hookData: '0x',
        },
      },
    });

    // Submit burn-intent to Gateway API.
    const transferRes = await fetch(`${gatewayUrl}/v1/transfer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          burnIntent,
          signature: '0x' + signed.r.replace(/^0x/, '') + signed.s.replace(/^0x/, '') + signed.v.toString(16).padStart(2, '0'),
        },
      ]),
    });
    const transferJson: any = await transferRes.json();
    if (!transferRes.ok) {
      logger.warn({ userId: session.userId, transferJson }, 'gateway_withdraw:attestation_failed');
      throw new AppError('BAD_GATEWAY', `Withdraw failed: ${JSON.stringify(transferJson).slice(0, 200)}`, 502);
    }
    const transferId = Array.isArray(transferJson) ? transferJson[0]?.transferId : transferJson?.transferId;
    logger.info({ userId: session.userId, transferId, amountUsdc }, 'gateway_withdraw:submitted');

    return new Response(
      JSON.stringify({
        ok: true,
        amountUsdc,
        transferId,
        note: 'On-chain USDC arrives in your wallet once the Gateway batch settles (instant for same-chain).',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
  { requireAuth: true, requireCsrf: true },
);