/**
 * GET /api/admin/decision/[id]
 *   Returns the full AgentDecisionLog row + linked ManualReview / FraudAlert
 *   for the AI Explainability panel.
 *
 * Supports id of:
 *   - AgentDecisionLog.id (the canonical usage)
 *   - FraudAlert.id        (returns the most-recent fraud_sentinel log for that alert)
 *   - ManualReview.id      (returns the most-recent fan log for that stream)
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
}

export const GET = withApi(async (req: Request) => {
  await requireAdmin();
  const id = (req as unknown as { params?: { id?: string } }).params?.id
    ?? new URL(req.url).pathname.split('/').pop();
  if (!id) throw new AppError('INVALID_INPUT', 'Missing id', 400);

  // Try AgentDecisionLog first
  let log = await prisma.agentDecisionLog.findUnique({ where: { id } });
  if (log) {
    return new Response(JSON.stringify({ decision: log }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // Try FraudAlert — synthesize a UI doc from the most-recent related log.
  const alert = await prisma.fraudAlert.findUnique({ where: { id } });
  if (alert) {
    const log = await prisma.agentDecisionLog.findFirst({
      where: {
        agent: 'fraud_sentinel',
        OR: [
          ...(alert.subjectUserId ? [{ userId: alert.subjectUserId }] : []),
          ...(alert.subjectWalletId ? [{ subjectType: 'wallet', subjectId: alert.subjectWalletId }] : []),
          { subjectId: alert.entityId, subjectType: alert.entityType },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return new Response(
      JSON.stringify({ decision: log, alert }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  // Try ManualReview
  const review = await prisma.manualReview.findUnique({ where: { id } });
  if (review) {
    const log = await prisma.agentDecisionLog.findFirst({
      where: { agent: 'fan', streamId: review.streamId },
      orderBy: { createdAt: 'desc' },
    });
    return new Response(
      JSON.stringify({ decision: log, review }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  throw new AppError('NOT_FOUND', 'Decision not found', 404);
});