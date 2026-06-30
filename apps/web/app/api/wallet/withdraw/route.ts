/**
 * POST /api/wallet/withdraw
 * Body: { toAddress, amountUsdc, memo? }
 */
import { z } from 'zod';
import { withApi, prisma, requireSession, ValidationError, AppError } from '@pazzera/core';
import { WalletService } from '@pazzera/blockchain';

const Body = z.object({
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  memo: z.string().max(200).optional(),
});

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const { getParsedBody } = await import('@pazzera/core');
    const body = getParsedBody<z.infer<typeof Body>>(req);
    const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not provisioned yet', 404);
    const result = await WalletService.transfer({
      userId: session.userId,
      walletId: wallet.id,
      toAddress: body.toAddress as `0x${string}`,
      amountUsdc: body.amountUsdc,
      memo: body.memo,
      type: 'withdraw',
    });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
  { bodySchema: Body, requireAuth: true, requireCsrf: true },
);