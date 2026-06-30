/**
 * GET /api/admin/recent-payments
 *
 * Returns the last 20 Payment rows (most recent first). Used by the
 * SettlementTimeline card on the admin dashboard.
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
}

export const GET = withApi(async () => {
  await requireAdmin();
  const rows = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, amountUsdc: true, status: true, createdAt: true, streamId: true, txHash: true },
  });
  return Response.json({
    payments: rows.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
    })),
  });
});
