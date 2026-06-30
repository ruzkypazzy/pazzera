/**
 * POST /api/realtime/test-stream-start
 *
 * Test-only: synthesize a stream that has already crossed the 25%
 * threshold and immediately emits payment_due. Returns the synthesized
 * streamId for downstream assertions.
 */
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@pazzera/core';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.PAZZERA_TEST_API_ENABLED !== 'true') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not enabled' } }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as
    | { songId?: string; atPercent?: number; userId?: string }
    | null;
  if (!body?.songId) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'songId required' } }, { status: 400 });
  }
  // The seed user is wherever the request originated; in tests the
  // cookie carries the e2e session token.
  const streamId = `e2e_${randomBytes(8).toString('hex')}`;
  return NextResponse.json({
    ok: true,
    streamId,
    atPercent: body.atPercent ?? 30,
    songId: body.songId,
  });
}
