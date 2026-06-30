/**
 * GET /api/payments/recent?streamId=...
 *
 * Returns the most recent payment rows. Used by the e2e suite and the
 * "activity" sidebar on the dashboard. Filters by streamId when
 * provided.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@pazzera/core';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const streamId = url.searchParams.get('streamId');
  const rows = await prisma.payment.findMany({
    where: streamId ? { streamId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      streamId: true,
      songId: true,
      amountUsdc: true,
      amountBaseUnits: true,
      status: true,
      txHash: true,
      settledAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ items: rows });
}
