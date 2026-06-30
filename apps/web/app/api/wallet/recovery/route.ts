/**
 * POST /api/wallet/recovery — request / verify / complete / cancel
 * Body: { action: 'request' | 'verify' | 'complete' | 'cancel', reason?, challenge? }
 */
import { z } from 'zod';
import { withApi, requireSession, AppError } from '@pazzera/core';
import { WalletRecoveryService } from '@pazzera/blockchain';
import { prisma } from '@pazzera/core';

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('request'),
    reason: z.enum(['lost_key', 'compromised', 'device_lost']),
  }),
  z.object({
    action: z.literal('verify'),
    challenge: z.string().min(20),
  }),
  z.object({ action: z.literal('complete') }),
  z.object({ action: z.literal('cancel') }),
]);

export const POST = withApi(
  async ({ req }) => {
    const session = await requireSession();
    const { getParsedBody } = await import('@pazzera/core');
    const body = getParsedBody<z.infer<typeof Body>>(req);
    const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet not provisioned yet', 404);

    if (body.action === 'request') {
      const out = await WalletRecoveryService.request({
        userId: session.userId,
        walletId: wallet.id,
        reason: body.reason,
      });
      return new Response(
        JSON.stringify({ ok: true, ...out }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (body.action === 'verify') {
      await WalletRecoveryService.verifyChallenge({
        userId: session.userId,
        walletId: wallet.id,
        challenge: body.challenge,
      });
      return new Response(JSON.stringify({ ok: true, state: 'recovery_verified' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (body.action === 'complete') {
      // Get the current session token from the cookie
      const env = (await import('@pazzera/core')).getEnv();
      const cookie = req.headers.get('cookie') ?? '';
      const token = cookie
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${env.SESSION_COOKIE_NAME}=`))
        ?.split('=')[1];
      const out = await WalletRecoveryService.complete({
        userId: session.userId,
        walletId: wallet.id,
        currentSessionRawToken: token,
      });
      return new Response(JSON.stringify({ ok: true, ...out }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // cancel
    await WalletRecoveryService.cancel({ userId: session.userId, walletId: wallet.id });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
  { bodySchema: Body, requireAuth: true, requireCsrf: true },
);