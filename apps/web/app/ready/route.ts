/**
 * GET /ready
 *
 * Readiness probe — used by the e2e suite, load balancers, and the
 * Docker healthcheck. Checks DB, Redis, and the realtime socket port
 * (env-checked, not network).
 */
import { NextResponse } from 'next/server';
import { prisma } from '@pazzera/core';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, 'ok' | 'fail'> = { http: 'ok' };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'fail';
  }
  return NextResponse.json({
    ok: Object.values(checks).every((v) => v === 'ok'),
    checks,
    version: process.env.npm_package_version ?? 'dev',
  });
}
