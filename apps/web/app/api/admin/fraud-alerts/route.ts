/**
 * GET /api/admin/fraud-alerts
 *   Live list of FraudAlert rows (severity, subject, reasons).
 *   Optional filter: ?severity=high|critical&status=open|under_review
 *
 * POST /api/admin/fraud-alerts
 *   Body: { alertId, action: 'resolve'|'false_positive'|'escalate', note?: string }
 */
import { z } from 'zod';
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
  return { session, me };
}

export const GET = withApi(async (req: any) => {
  await requireAdmin();
  const url = new URL(req.url);
  const severity = url.searchParams.get('severity');
  const status = url.searchParams.get('status') ?? 'open';
  const take = Number(url.searchParams.get('take') ?? 50);
  const alerts = await prisma.fraudAlert.findMany({
    where: {
      ...(severity ? { severity } : {}),
      status: status as string,
    },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    take: Number.isFinite(take) ? Math.min(200, take) : 50,
  });
  return new Response(JSON.stringify({ alerts }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const POST_SCHEMA = z.object({
  alertId: z.string().min(1),
  action: z.enum(['resolve', 'false_positive', 'escalate']),
  note: z.string().max(500).optional(),
});

export const POST = withApi(async (req: any) => {
  const { session } = await requireAdmin();
  const body = await req.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) throw new AppError('INVALID_INPUT', parsed.error.message, 400);

  const newStatus =
    parsed.data.action === 'false_positive' ? 'false_positive'
      : parsed.data.action === 'escalate' ? 'under_review'
        : 'resolved';

  await prisma.fraudAlert.update({
    where: { id: parsed.data.alertId },
    data: {
      status: newStatus,
      decidedById: session.userId,
      decidedAt: new Date(),
      decisionNote: parsed.data.note,
    },
  });

  return new Response(JSON.stringify({ ok: true, status: newStatus }), { status: 200, headers: { 'content-type': 'application/json' } });
});