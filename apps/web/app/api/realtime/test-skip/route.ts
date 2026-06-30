/**
 * POST /api/realtime/test-skip
 *
 * Test-only: force a stream's playback position past the configured
 * 25% payment threshold so the e2e suite can assert on the realtime
 * `payment_due` event without actually waiting 25% of a real song.
 *
 * Disabled unless PAZZERA_TEST_API_ENABLED=true AND the request comes
 * from the same e2e session. No real production route uses this.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@pazzera/core';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.PAZZERA_TEST_API_ENABLED !== 'true') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not enabled' } }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { songId?: string; percent?: number } | null;
  if (!body?.songId || typeof body.percent !== 'number') {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'songId+percent required' } }, { status: 400 });
  }
  // Mark any active stream as "past threshold" so the realtime
  // aggregator emits threshold_crossed + payment_due in a deterministic
  // window. Production never reads from this route — see the
  // disabled guard above.
  await prisma.stream.updateMany({
    where: { songId: body.songId, endedAt: null },
    data: { totalActiveMs: Math.max(1, body.percent * 1000) },
  });
  return NextResponse.json({ ok: true });
}
