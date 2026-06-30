/**
 * GET /api/wallet/balance
 * Returns the cached balance + provider + status. Optionally ?refresh=1 to fetch on-chain.
 */
import { withApi, prisma, requireSession } from '@pazzera/core';
import { WalletService } from '@pazzera/blockchain';

export const GET = withApi(async ({ req }) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1';

  const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
  if (!wallet) {
    return new Response(
      JSON.stringify({ ok: false, status: 'pending_provisioning' }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );
  }
  if (refresh) {
    try {
      await WalletService.refreshBalance(wallet.id);
    } catch {
      // ignore — return cached
    }
  }
  const fresh = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  return new Response(
    JSON.stringify({
      ok: true,
      wallet: {
        address: fresh!.address,
        status: fresh!.status,
        provider: fresh!.provider,
        custody: fresh!.custody,
        balanceUsdc: fresh!.balanceUsdc,
        pendingUsdc: fresh!.pendingUsdc,
        x402DailyCapUsdc: fresh!.x402DailyCapUsdc,
        x402PerStreamCapUsdc: fresh!.x402PerStreamCapUsdc,
        x402AuthorizedAt: fresh!.x402AuthorizedAt,
        frozenAt: fresh!.frozenAt,
        compromisedAt: fresh!.compromisedAt,
        recoveryRequestedAt: fresh!.recoveryRequestedAt,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});