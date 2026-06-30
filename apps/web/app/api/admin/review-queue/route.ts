/**
 * GET /api/admin/review-queue
 *   Returns pending ManualReview rows joined with Stream + Song + User.
 *
 * POST /api/admin/review-queue
 *   Body: { reviewId, action: 'approve'|'reject'|'refund', note?: string }
 *   Performs the action, audits in ManualReview.decisionReason.
 */
import { z } from 'zod';
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';
import { logger } from '@pazzera/core';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
  return { session, me };
}

export const GET = withApi(async () => {
  await requireAdmin();
  const reviews = await prisma.manualReview.findMany({
    where: { status: 'pending' },
    orderBy: [{ fraudScore: 'desc' }, { createdAt: 'desc' }],
    take: 60,
    include: {
      stream: { select: { id: true, startedAt: true, songId: true, classification: true, fraudScore: true, fraudSignals: true } },
      song: { select: { id: true, title: true, artistName: true } },
      subject: { select: { id: true, username: true, email: true } },
      decidedBy: { select: { id: true, username: true } },
    },
  });

  return new Response(
    JSON.stringify({
      reviews: reviews.map((r) => ({
        id: r.id,
        status: r.status,
        fraudScore: r.fraudScore,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decidedBy: r.decidedBy?.username ?? null,
        decisionReason: r.decisionReason,
        song: r.song,
        user: r.subject,
        stream: r.stream,
        signals: r.fraudSignals,
      })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});

const POST_SCHEMA = z.object({
  reviewId: z.string().min(1),
  action: z.enum(['approve', 'reject', 'refund']),
  note: z.string().max(500).optional(),
});

export const POST = withApi(async (req: any) => {
  const { session, me } = await requireAdmin();
  const body = await req.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) throw new AppError('INVALID_INPUT', parsed.error.message, 400);

  const review = await prisma.manualReview.findUnique({ where: { id: parsed.data.reviewId } });
  if (!review) throw new AppError('NOT_FOUND', 'Review not found', 404);
  if (review.status !== 'pending') throw new AppError('CONFLICT', 'Review already decided', 409);

  const newStatus = parsed.data.action === 'approve' ? 'approved' : parsed.data.action === 'reject' ? 'rejected' : 'refunded';

  await prisma.$transaction(async (tx) => {
    await tx.manualReview.update({
      where: { id: parsed.data.reviewId },
      data: {
        status: newStatus,
        decidedById: session.userId,
        decidedAt: new Date(),
        decisionReason: parsed.data.note,
      },
    });

    // Side effect: if refund, mark the related payment as refunded.
    if (parsed.data.action === 'refund') {
      const stream = await tx.stream.findUnique({ where: { id: review.streamId }, include: { payment: true } });
      if (stream?.payment) {
        await tx.payment.update({
          where: { id: stream.payment.id },
          data: { status: 'refunded', refundedAt: new Date() },
        });
      }
    }

    // Audit trail (use AuthEvent as well; AgentLog uses AgentName which doesn't include admin)
    await tx.authEvent.create({
      data: {
        userId: me?.id,
        type: 'manual_review_decided',
        severity: parsed.data.action === 'approve' ? 10 : 40,
        meta: {
          reviewId: parsed.data.reviewId,
          action: parsed.data.action,
          note: parsed.data.note ?? null,
        },
      },
    });
  });

  logger.info({ reviewId: parsed.data.reviewId, action: parsed.data.action }, 'admin:review_decided');

  return new Response(JSON.stringify({ ok: true, status: newStatus }), { status: 200, headers: { 'content-type': 'application/json' } });
});