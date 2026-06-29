/**
 * Fan worker — picks up threshold-crossed streams, runs anti-abuse checks,
 * then enqueues the payment settlement job with a pre-built EIP-712
 * authorization envelope (which the client must sign and return via the
 * socket; the worker just prepares the parameters).
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES, enqueue } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger, getEnv } from '@pazzera/core';
import { decideFan, type FanStreamContext } from '../fan/decide';

export async function runFanWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentFan,
    async (job: Job) => {
      const { streamId } = job.data as { streamId: string };
      logger.info({ streamId, jobId: job.id }, 'fan:start');

      const stream = await prisma.stream.findUnique({
        where: { id: streamId },
        include: {
          song: {
            select: { durationSeconds: true, publishedPriceUsdc: true, isPublic: true },
          },
          ticks: { orderBy: { monotonicMs: 'asc' } },
        },
      });
      if (!stream) {
        logger.warn({ streamId }, 'fan:stream_missing');
        return;
      }

      // Compute activeMs (excludes pauses)
      let activeMs = 0;
      let lastTickMonotonic = stream.ticks[0]?.monotonicMs ?? stream.startedAt.getTime();
      let largeSeekCount = 0;
      for (let i = 1; i < stream.ticks.length; i++) {
        const prev = stream.ticks[i - 1]!;
        const cur = stream.ticks[i]!;
        if (!prev.wasPause && !cur.wasPause) {
          activeMs += cur.monotonicMs - lastTickMonotonic;
        }
        const posDelta = Math.abs(cur.positionSec - prev.positionSec);
        if (posDelta > 5) largeSeekCount += 1;
        lastTickMonotonic = cur.monotonicMs;
      }

      // Concurrent stream check
      const concurrent = await prisma.stream.count({
        where: {
          userId: stream.userId,
          id: { not: stream.id },
          startedAt: { gte: new Date(Date.now() - 60_000) },
          endedAt: null,
        },
      });

      const ctx: FanStreamContext = {
        streamId: stream.id,
        userId: stream.userId,
        songId: stream.songId,
        durationSeconds: stream.song.durationSeconds,
        startedAt: stream.startedAt,
        endedAt: stream.endedAt,
        charged: stream.charged,
        flaggedAbuse: stream.flaggedAbuse,
        ticks: stream.ticks.map((t) => ({
          monotonicMs: t.monotonicMs.getTime(),
          positionSec: t.positionSec,
          wasSeek: t.wasSeek,
          wasPause: t.wasPause,
        })),
        largeSeekCount,
        activeMs,
        hasRecentConcurrentStream: concurrent > 0,
      };

      const decision = decideFan({ streamId }, ctx);

      await prisma.agentLog.create({
        data: {
          agent: 'fan',
          streamId: stream.id,
          decision: decision.shouldCharge ? 'charge' : 'skip',
          reason: decision.reason,
          payloadJson: JSON.stringify({ ctx, decision }),
        },
      });

      if (!decision.shouldCharge) {
        logger.info({ streamId, reason: decision.reason }, 'fan:skip');
        return;
      }

      // Eligible → create a pending Payment row and let the realtime layer
      // build the EIP-712 envelope when the client signs.
      const env = getEnv();
      const priceUsdc = stream.song.publishedPriceUsdc;
      const amountBaseUnits = (
        BigInt(Math.floor(Number(priceUsdc) * 10 ** env.USDC_DECIMALS))
      ).toString();

      await prisma.payment.upsert({
        where: { streamId: stream.id },
        create: {
          streamId: stream.id,
          songId: stream.songId,
          payerUserId: stream.userId,
          amountUsdc: priceUsdc,
          amountBaseUnits,
          status: 'pending',
        },
        update: {
          amountUsdc: priceUsdc,
          amountBaseUnits,
          status: 'pending',
        },
      });

      logger.info({ streamId, amountBaseUnits }, 'fan:charge_ready');
      // The realtime gateway will pick up the pending state on the next tick
      // and emit stream:payment_due with the actual amount + recipient.
    },
    { connection: getQueueConnection(), concurrency: 32 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'fan:failed');
  });

  return worker;
}

// Helper for the realtime layer to build EIP-712 params for the listener to sign.
export async function buildPaymentDueParams(streamId: string) {
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    include: {
      song: {
        select: {
          publishedPriceUsdc: true,
          artistId: true,
          artist: { select: { wallet: { select: { address: true } } } },
        },
      },
      payer: { select: { wallet: { select: { address: true } } } },
    },
  });
  if (!stream) return null;
  const payment = await prisma.payment.findUnique({ where: { streamId } });
  if (!payment) return null;

  const env = getEnv();
  const nonce = `0x${Array.from(new Uint8Array(32), () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('')}` as `0x${string}`;

  return {
    streamId,
    songId: stream.songId,
    amountUsdc: stream.song.publishedPriceUsdc,
    amountBaseUnits: payment.amountBaseUnits,
    from: stream.payer.wallet?.address,
    to: stream.song.artist.wallet?.address,
    nonce,
    validAfter: String(Math.floor(Date.now() / 1000)),
    validBefore: String(Math.floor(Date.now() / 1000) + 60),
    chainId: env.ARC_CHAIN_ID,
    usdcContract: env.USDC_CONTRACT_ADDRESS,
  };
}