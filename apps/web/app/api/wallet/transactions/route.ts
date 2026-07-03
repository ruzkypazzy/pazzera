/**
 * GET /api/wallet/transactions
 * Returns the user's wallet transactions (both on-chain USDC transfers
 * and Gateway-balance credits like royalty_payout from listener streams).
 *
 * On-chain transfers come from WalletTransaction (set by the wallet
 * indexer when it sees Transfer events). Gateway-balance changes come
 * from LedgerEntry (set by the split-worker when distributing earnings).
 * The two are unioned and sorted by createdAt desc.
 */
import { withApi, prisma, requireSession } from '@pazzera/core';

type Row = {
  id: string;
  type: string;
  direction: 'credit' | 'debit';
  amountUsdc: string;
  amountBaseUnits?: string;
  status: string;
  txHash?: string | null;
  counterpartyAddress?: string | null;
  confirmedAt?: Date | null;
  createdAt: Date;
  memo?: string | null;
  source: 'wallet' | 'gateway';
};

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

  const cursorDate = cursor ? new Date(cursor) : null;

  // On-chain USDC transfers (debited or credited on the wallet itself).
  const onChain = await prisma.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  // Gateway Balance credits (royalty_payouts + future kinds like
  // gateway_topup, gateway_withdraw). `toWalletId` is the artist's
  // wallet; `fromWalletId` would be the listener's wallet for
  // stream_payment kind. We surface any entry that touches this
  // user's wallet in either direction.
  const gateway = await prisma.ledgerEntry.findMany({
    where: {
      OR: [{ toWalletId: wallet.id }, { fromWalletId: wallet.id }],
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  // Union + sort.
  const rows: Row[] = [
    ...onChain.map((t): Row => ({
      id: t.id,
      type: t.type,
      direction: t.direction as 'credit' | 'debit',
      amountUsdc: t.amountUsdc,
      amountBaseUnits: t.amountBaseUnits,
      status: t.status,
      txHash: t.txHash,
      counterpartyAddress: t.counterpartyAddress,
      confirmedAt: t.confirmedAt,
      createdAt: t.createdAt,
      memo: t.memo,
      source: 'wallet',
    })),
    ...gateway.map((g): Row => ({
      id: g.id,
      type: g.kind, // 'royalty_payout', 'stream_payment', 'gateway_topup', etc.
      direction: g.direction as 'credit' | 'debit',
      amountUsdc: (Number(g.splitAmountBaseUnits) / 1_000_000).toFixed(6),
      amountBaseUnits: g.splitAmountBaseUnits,
      status: g.status,
      txHash: g.chainTxHash,
      counterpartyAddress: g.toWalletId === wallet.id ? g.fromAddress : g.toAddress,
      confirmedAt: g.chainConfirmedAt,
      createdAt: g.createdAt,
      memo: g.memo,
      source: 'gateway',
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit + 1);

  const hasMore = rows.length > limit;
  const transactions = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? transactions[transactions.length - 1]!.createdAt.toISOString() : null;

  return new Response(
    JSON.stringify({ ok: true, transactions, nextCursor }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});