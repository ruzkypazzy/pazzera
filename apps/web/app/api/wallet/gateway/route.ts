/**
 * GET /api/wallet/gateway
 * Returns the user's Circle Gateway Balance (live) + recent Gateway activity.
 *
 * Two balance layers:
 *   - on-chain wallet:     stored in Postgres (balanceUsdc)
 *   - Gateway Balance:     held inside Circle Gateway Wallet contract;
 *                          queried via Circle API in real-time
 *
 * Both are needed because Circle x402 batched payments are debited from
 * the Gateway Balance, NOT from on-chain USDC per-payment. New listeners
 * need to top up Gateway before they can pay.
 */
import { withApi, prisma, requireSession, getEnv, logger } from '@pazzera/core';

const GATEWAY_USDC_DOMAIN = 26; // Arc Testnet domain in Circle's catalog

interface GatewayBalanceResponse {
  ok: boolean;
  address?: string;
  status?: string;
  balanceUsdc?: string;
  pendingBatchUsdc?: string;
  // On-chain (separate ledger, settled by Circle after batch close).
  onChainUsdc?: string;
  recent?: Array<{ txId: string; amount: string; direction: 'credit' | 'debit'; counterparty: string; ts: string; status: string }>;
  error?: string;
}

async function fetchGatewayBalance(
  apiKey: string,
  gatewayUrl: string,
  depositorAddress: string,
): Promise<{ balance: string; pendingBatch: string } | null> {
  try {
    const r = await fetch(`${gatewayUrl}/v1/balances`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'USDC',
        sources: [{ depositor: depositorAddress, domain: GATEWAY_USDC_DOMAIN }],
      }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const b = j?.balances?.[0];
    return {
      balance: b?.balance ?? '0',
      pendingBatch: b?.pendingBatch ?? '0',
    };
  } catch {
    return null;
  }
}

async function fetchRecentGatewayPayments(
  apiKey: string,
  gatewayUrl: string,
  depositorAddress: string,
  limit: number,
): Promise<Array<{ txId: string; amount: string; direction: 'credit' | 'debit'; counterparty: string; ts: string; status: string }>> {
  // Circle's recent transfers endpoint for Gateway. Returns batched transfers
  // that affect this depositor. Best-effort; if unavailable, return [].
  try {
    const r = await fetch(
      `${gatewayUrl}/v1/transfers?depositor=${depositorAddress}&token=USDC&limit=${limit}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!r.ok) return [];
    const j: any = await r.json();
    const txs: any[] = Array.isArray(j?.transfers) ? j.transfers : Array.isArray(j?.data) ? j.data : [];
    return txs.map((t) => ({
      txId: t.transferId ?? t.id ?? '',
      amount: t.amount ?? '0',
      direction: (t.from?.toLowerCase?.() === depositorAddress.toLowerCase() ? 'debit' : 'credit') as 'credit' | 'debit',
      counterparty: t.to ?? t.from ?? '',
      ts: t.createdAt ?? t.timestamp ?? '',
      status: t.status ?? 'unknown',
    }));
  } catch {
    return [];
  }
}

export const GET = withApi(async ({ req }) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1';

  const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
  if (!wallet) {
    return new Response(
      JSON.stringify({ ok: false, status: 'pending_provisioning' } satisfies GatewayBalanceResponse),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );
  }

  const env = getEnv();
  const apiKey = env.CIRCLE_API_KEY;
  const gatewayUrl = env.CIRCLE_GATEWAY_FACILITATOR_URL || 'https://gateway-api-testnet.circle.com';

  if (!refresh && wallet.balanceUsdc !== '0') {
    // First-paint from DB; subsequent polls refresh.
  }
  const gateway = await fetchGatewayBalance(apiKey, gatewayUrl, wallet.address);
  if (!gateway) {
    logger.warn({ userId: session.userId, address: wallet.address }, 'gateway_balance_query_failed');
    return new Response(
      JSON.stringify({
        ok: false,
        address: wallet.address,
        onChainUsdc: wallet.balanceUsdc,
        error: 'Circle Gateway balance unavailable',
      } satisfies GatewayBalanceResponse),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
  const recent = await fetchRecentGatewayPayments(apiKey, gatewayUrl, wallet.address, 10);

  return new Response(
    JSON.stringify({
      ok: true,
      address: wallet.address,
      balanceUsdc: gateway.balance,
      pendingBatchUsdc: gateway.pendingBatch,
      onChainUsdc: wallet.balanceUsdc,
      recent,
    } satisfies GatewayBalanceResponse),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});