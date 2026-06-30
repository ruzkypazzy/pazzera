/**
 * GET /api/wallet/transactions
 * Returns the user's wallet transactions, paginated.
 */
import { withApi, prisma, requireSession } from '@pazzera/core';

export const GET = withApi(async ({ req }) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '25')));
  const cursor = url.searchParams.get('cursor');
  const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
  if (!wallet) {
    return new Response(JSON.stringify({ ok: true, transactions: [], nextCursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const rows = await prisma.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const transactions = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? transactions[transactions.length - 1]!.createdAt.toISOString() : null;
  return new Response(
    JSON.stringify({ ok: true, transactions, nextCursor }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});