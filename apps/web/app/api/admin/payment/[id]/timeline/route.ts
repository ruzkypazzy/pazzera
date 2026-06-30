/**
 * GET /api/admin/payment/[id]/timeline
 *
 * Returns the settlement timeline for a given Payment: every PaymentEvent
 * row tagged with this paymentId, sorted by createdAt.
 *
 * Each event maps to one of:
 *   - payment_due          → step 1
 *   - payment_authorized   → step 2 (from webhook or directly)
 *   - payment_submitted    → step 3 (transfer.pending webhook)
 *   - payment_confirmed    → step 4 (transfer.complete webhook)
 *   - failed               → any payment_failed event
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';
import { getEnv } from '@pazzera/core/config/env';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
}

export const GET = withApi(async (req: any) => {
  await requireAdmin();
  const id = (req as unknown as { params?: { id?: string } }).params?.id
    ?? new URL(req.url).pathname.split('/').filter((s) => s).pop();
  if (!id) throw new AppError('INVALID_INPUT', 'Missing paymentId', 400);

  const payment = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, amountUsdc: true, txHash: true, streamId: true },
  });
  if (!payment) throw new AppError('NOT_FOUND', 'Payment not found', 404);

  const events = await prisma.paymentEvent.findMany({
    where: { paymentId: id },
    orderBy: { createdAt: 'asc' },
  });

  const timeline = events.map((e) => {
    let kind:
      | 'payment_due'
      | 'payment_authorized'
      | 'payment_submitted'
      | 'payment_confirmed'
      | 'failed';
    if (e.kind === 'payment_due') kind = 'payment_due';
    else if (e.kind === 'payment_failed') kind = 'failed';
    else if (e.kind === 'payment_settled') {
      // Decide which step based on the meta
      const meta = e.meta as { source?: string } | null;
      kind = meta?.source === 'webhook' ? 'payment_confirmed' : 'payment_submitted';
    } else kind = 'payment_submitted'; // generic
    return {
      ts: e.createdAt.getTime(),
      kind,
      meta: e.meta as Record<string, unknown> | undefined,
    };
  });

  return Response.json({
    paymentId: payment.id,
    amountUsdc: payment.amountUsdc,
    txHash: payment.txHash,
    network: `eip155:${getEnv().ARC_CHAIN_ID}`,
    events: timeline,
  });
});
