/**
 * GET /api/admin/payments-health
 *
 * Live payments infrastructure observability:
 *   - counts of payments pending / confirmed / failed (live + last 24h)
 *   - avg settlement latency (ms)
 *   - webhook lag (most recent webhook event vs server time)
 *   - balance drift count (from wallet:reconcile worker)
 *
 * Cards: payments_pending, payments_confirmed, payments_failed,
 *        avg_settlement_latency_ms, webhook_lag_ms, balance_drift_count
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';
import { driftCounters } from '@pazzera/agents/utils/drift-counters';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
}

export const GET = withApi(async () => {
  await requireAdmin();

  const since24h = new Date(Date.now() - 86_400_000);
  const [pending, confirmed, failed, latencies, lastWebhook, drift, settlementFailures] = await Promise.all([
    prisma.payment.count({ where: { status: 'pending' } }),
    prisma.payment.count({ where: { status: { in: ['settled', 'distributed'] }, settledAt: { gte: since24h } } }),
    prisma.payment.count({ where: { status: 'failed', updatedAt: { gte: since24h } } }),
    prisma.paymentEvent.findMany({
      where: { kind: 'payment_settled', createdAt: { gte: since24h } },
      select: { meta: true },
      take: 200,
    }),
    prisma.paymentEvent.findFirst({ where: { kind: 'payment_settled' }, orderBy: { createdAt: 'desc' } }),
    prisma.paymentEvent.count({ where: { kind: 'balance_drift', createdAt: { gte: since24h } } }),
    prisma.paymentEvent.count({ where: { kind: 'payment_failed', createdAt: { gte: since24h } } }),
  ]);

  // Compute avg latency from PaymentEvent.meta.latencyMs where present
  const latencyValues: number[] = [];
  for (const e of latencies) {
    const meta = e.meta as { latencyMs?: number } | null;
    if (meta?.latencyMs && Number.isFinite(meta.latencyMs)) {
      latencyValues.push(meta.latencyMs);
    }
  }
  const avg = latencyValues.length === 0 ? 0 : Math.round(latencyValues.reduce((s, n) => s + n, 0) / latencyValues.length);

  // Webhook lag: now - lastWebhookCreatedAt, only if recent enough
  const webhookLagMs = lastWebhook ? Date.now() - lastWebhook.createdAt.getTime() : null;

  return Response.json({
    paymentsPending: pending,
    paymentsConfirmed: confirmed,
    paymentsFailed: failed,
    avgSettlementLatencyMs: avg,
    webhookLagMs,
    balanceDriftCount: drift,
    settlementFailureCount: settlementFailures,
    walletReconcile: {
      lastRunAt: driftCounters.lastRunAt ? new Date(driftCounters.lastRunAt).toISOString() : null,
      walletsChecked: driftCounters.walletsChecked,
      driftDetected: driftCounters.driftDetected,
      driftRepaired: driftCounters.driftRepaired,
    },
    timestamp: new Date().toISOString(),
  });
});
