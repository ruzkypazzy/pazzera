/**
 * GET /api/auth/test-otp?email=...
 *
 * Test-only: returns the most recent unconsumed OTP's `debugCode` for
 * a given email. Mounted ONLY when NODE_ENV !== 'production' AND
 * PAZZERA_TEST_API_ENABLED === 'true'. Disabled in all real builds.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@pazzera/core';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.PAZZERA_TEST_API_ENABLED !== 'true') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not enabled' } }, { status: 404 });
  }
  const url = new URL(req.url);
  const email = url.searchParams.get('email')?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'email required' } }, { status: 400 });
  }
  const otp = await prisma.otpCode.findFirst({
    where: { email, consumedAt: null, debugCode: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { debugCode: true },
  });
  if (!otp?.debugCode) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No fresh OTP' } }, { status: 404 });
  }
  return NextResponse.json({ code: otp.debugCode });
}
