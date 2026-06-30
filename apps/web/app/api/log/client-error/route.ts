/**
 * POST /api/log/client-error
 *
 * Single ingestion point for client-side exceptions. Joins the
 * incoming correlation ID with the server-side structured logger so
 * Phase 10 observability stays correlated across the request hop.
 */
import { NextResponse } from 'next/server';
import { logger } from '@pazzera/core';

export const dynamic = 'force-dynamic';

interface ClientErrorPayload {
  surface?: string;
  correlationId?: string | null;
  error?: { name?: string; message?: string; stack?: string };
  info?: { componentStack?: string };
  url?: string;
  userAgent?: string;
  ts?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ClientErrorPayload | null;
  if (!body) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'invalid json' } }, { status: 400 });
  }
  logger.warn(
    {
      kind: 'client_error',
      surface: body.surface,
      correlationId: body.correlationId ?? null,
      url: body.url,
      userAgent: body.userAgent,
      clientError: body.error,
      clientComponentStack: body.info?.componentStack,
      clientTs: body.ts,
    },
    'web:client_error',
  );
  return NextResponse.json({ ok: true });
}
