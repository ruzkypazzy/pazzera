/**
 * GET /api/admin/agent-health
 *   Per-agent health metrics (queue depth + success rate + p50/p95 latency)
 *   from the most-recent AgentHealthMetrics bucket.
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';
import type { Prisma } from '@prisma/client';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
  return { session, me };
}

export const GET = withApi(async () => {
  await requireAdmin();
  const since = new Date(Date.now() - 5 * 60_000);
  const rows = await prisma.agentHealthMetrics.findMany({
    where: { scope: 'minute', bucketStart: { gte: since } },
    orderBy: [{ agent: 'asc' }, { bucketStart: 'desc' }],
  });

  // Reduce: keep the latest bucket per agent
  const byAgent = new Map<string, typeof rows[number]>();
  for (const r of rows) if (!byAgent.has(r.agent)) byAgent.set(r.agent, r);

  // Also try real queue depth via BullMQ if available
  let queueDepth: Record<string, { waiting: number; active: number; failed: number }> = {};
  try {
    const { getQueueConnection, QUEUE_NAMES } = await import('@pazzera/queue');
    const conn = getQueueConnection();
    const { Queue } = await import('bullmq');
    const names = Object.values(QUEUE_NAMES);
    queueDepth = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => {
          const q = new Queue(name, { connection: conn });
          try {
            const counts = (await q.getJobCounts('waiting', 'active', 'failed')) as { waiting: number; active: number; failed: number };
            await q.close().catch(() => undefined);
            return [name, counts] as const;
          } catch {
            await q.close().catch(() => undefined);
            return [name, { waiting: 0, active: 0, failed: 0 }] as const;
          }
        }),
      ),
    );
  } catch {
    // ignore — Redis may be unreachable in dev
  }

  return new Response(
    JSON.stringify({
      agents: [...byAgent.values()].map((r) => ({
        agent: r.agent,
        status: r.status,
        successRate: r.successRate,
        jobsProcessed: r.jobsProcessed,
        jobsFailed: r.jobsFailed,
        p50LatencyMs: r.p50LatencyMs,
        p95LatencyMs: r.p95LatencyMs,
        p99LatencyMs: r.p99LatencyMs,
        queueDepth: r.queueDepth,
        lastExecutionAt: r.lastExecutionAt?.toISOString() ?? null,
      })),
      queueDepth: queueDepth as Record<string, unknown>,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});