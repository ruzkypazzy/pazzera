/**
 * GET /api/admin/streaming-health
 *   Live streaming infrastructure observability.
 *   Combines in-memory counters from the realtime process (snapshot via Redis-backed
 *   cache or direct poll) with Postgres rolling counts.
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';
import { getRecentEventCounts } from '@pazzera/realtime/event-log';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
}

export const GET = withApi(async () => {
  await requireAdmin();

  const since = new Date(Date.now() - 60_000);
  const since24h = new Date(Date.now() - 24 * 3_600_000);

  const [
    liveEventCounts,
    activeStreams24h,
    chargedStreamsLastMin,
    suspiciousLastMin,
    uniqListenersLast5min,
    uniqListeners5min,
  ] = await Promise.all([
    getRecentEventCounts(),
    prisma.stream.count({ where: { endedAt: null } }),
    prisma.stream.count({ where: { charged: true, chargedAt: { gte: since } } }),
    prisma.stream.count({ where: { manualReview: true, startedAt: { gte: since } } }),
    prisma.stream.findMany({
      where: { startedAt: { gte: new Date(Date.now() - 5 * 60_000) } },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.stream.findMany({
      where: { startedAt: { gte: new Date(Date.now() - 5 * 60_000) } },
      select: { userId: true },
    }),
  ]);

  return new Response(
    JSON.stringify({
      ...liveEventCounts,
      activeStreams: activeStreams24h,
      chargedPerMin: chargedStreamsLastMin,
      suspiciousPerMin: suspiciousLastMin,
      uniqueListenersLast5Min: uniqListenersLast5min.length,
      recentStreamCount5Min: uniqListeners5min.length,
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});
