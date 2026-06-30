/**
 * GET /api/admin/overview
 * Aggregated admin metrics + recent agent activity + risk events.
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';
import { getQueueConnection } from '@pazzera/queue';

export const GET = withApi(async () => {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const isAdmin = me?.role === 'admin' || (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);

  const since5min = new Date(Date.now() - 5 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 86400_000);

  const [totalUsers, artists, streamsToday, activeListeners, totalVolume, totalPayments, agentFeed, riskEvents, recentDecisions, liveFraudAlerts, pendingReviews, manualReviewCount] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isArtist: true } }),
    prisma.stream.count({ where: { startedAt: { gte: since24h } } }),
    prisma.stream.findMany({
      where: { startedAt: { gte: since7d } },
      select: { userId: true },
      distinct: ['userId'],
    }).then((rows) => rows.length),
    prisma.payment.aggregate({
      where: { status: { in: ['settled', 'distributed'] } },
      _sum: { amountBaseUnits: true, amountUsdc: true },
    }),
    prisma.payment.count({ where: { status: { in: ['settled', 'distributed'] } } }),
    prisma.agentLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.authEvent.findMany({
      where: { createdAt: { gte: since24h }, severity: { gte: 30 } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.agentDecisionLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, agent: true, subjectType: true, subjectId: true,
        decision: true, confidence: true, reasons: true, latencyMs: true,
        createdAt: true, songId: true, streamId: true, paymentId: true, userId: true,
      },
    }),
    prisma.fraudAlert.findMany({
      where: { status: 'open', severity: { in: ['high', 'critical'] } },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    }),
    prisma.manualReview.findMany({
      where: { status: 'pending' },
      orderBy: [{ fraudScore: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      include: {
        stream: { select: { id: true, songId: true, classification: true, fraudScore: true } },
        song: { select: { id: true, title: true, artistName: true } },
        subject: { select: { id: true, username: true } },
      },
    }),
    prisma.manualReview.count({ where: { status: 'pending' } }),
  ]);

  // Queue status via BullMQ
  let queueStatus: { name: string; waiting: number; active: number; failed: number; delayed: number }[] = [];
  try {
    const { getQueueConnection, QUEUE_NAMES } = await import('@pazzera/queue');
    const conn = getQueueConnection();
    const names = Object.values(QUEUE_NAMES);
    queueStatus = await Promise.all(
      names.map(async (name) => {
        const { Queue } = await import('bullmq');
        const q = new Queue(name, { connection: conn });
        const counts = await q.getJobCounts('waiting', 'active', 'failed', 'delayed');
        await q.close().catch(() => undefined);
        return { name, ...counts };
      }),
    );
  } catch {
    queueStatus = [];
  }

  return new Response(
    JSON.stringify({
      metrics: {
        totalUsers,
        activeListeners,
        artists,
        streamsToday,
        totalPayments,
        totalUsdcVolume: (Number(totalVolume._sum.amountBaseUnits ?? '0') / 1_000_000).toString(),
        pendingReviewCount: manualReviewCount,
      },
      agentFeed: agentFeed.map((e) => ({
        id: e.id,
        agent: e.agent,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        decision: e.decision,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
      riskEvents: riskEvents.map((e) => ({
        id: e.id,
        type: e.type,
        severity: e.severity,
        meta: e.meta as Record<string, unknown> | null,
        createdAt: e.createdAt.toISOString(),
      })),
      decisions: recentDecisions.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
      fraudAlerts: liveFraudAlerts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(), decidedAt: a.decidedAt?.toISOString() ?? null })),
      reviewQueue: pendingReviews.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
      })),
      queueStatus,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});