/**
 * POST /api/auth/test-promote
 *
 * Test-only: promote an existing user to the `admin` role. Disabled
 * outside NODE_ENV !== 'production' AND when PAZZERA_TEST_API_ENABLED
 * is explicitly set. Used by the e2e suite to seed an admin account.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@pazzera/core';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.PAZZERA_TEST_API_ENABLED !== 'true') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not enabled' } }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { email?: string; role?: string } | null;
  if (!body?.email || !body.role) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'email+role required' } }, { status: 400 });
  }
  const updated = await prisma.user.update({
    where: { email: body.email.toLowerCase() },
    data: { role: body.role },
    select: { id: true, email: true, role: true },
  });
  return NextResponse.json({ ok: true, user: updated });
}
