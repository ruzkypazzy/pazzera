/**
 * GET /api/admin/realtime
 *   SSE endpoint streaming most-recent AgentDecisionLog events as they arrive.
 *   Open from the admin dashboard for the "live" feel + replay during demos.
 *
 *   Falls back to a JSON snapshot if the client sends Accept: application/json.
 */
import { withApi, requireSession, prisma, AppError } from '@pazzera/core';

async function requireAdmin() {
  const session = await requireSession();
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, email: true } });
  const allowEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isAdmin = me?.role === 'admin' || allowEmails.includes(me?.email ?? '');
  if (!isAdmin) throw new AppError('FORBIDDEN', 'Admin access required', 403);
}

export const GET = withApi(async (req: any) => {
  await requireAdmin();
  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('application/json')) {
    const logs = await prisma.agentDecisionLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        agent: true,
        subjectType: true,
        subjectId: true,
        decision: true,
        confidence: true,
        reasons: true,
        latencyMs: true,
        createdAt: true,
        songId: true,
        streamId: true,
        paymentId: true,
        userId: true,
      },
    });
    return new Response(JSON.stringify({ events: logs }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // SSE: poll Postgres every 2s and emit only new rows.
  const encoder = new TextEncoder();
  let lastId: string | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller closed
        }
      };
      send('ready', { ok: true, ts: Date.now() });
      interval = setInterval(async () => {
        try {
          const rows = await prisma.agentDecisionLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20,
            where: lastId ? { id: { not: lastId } } : undefined,
            select: {
              id: true,
              agent: true,
              subjectType: true,
              subjectId: true,
              decision: true,
              confidence: true,
              reasons: true,
              latencyMs: true,
              createdAt: true,
              songId: true,
              streamId: true,
              paymentId: true,
              userId: true,
            },
          });
          for (const r of rows) send('decision', r);
          if (rows.length) lastId = rows[0]!.id;
        } catch (err) {
          send('error', { message: 'poll failed' });
        }
      }, 2_000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
});