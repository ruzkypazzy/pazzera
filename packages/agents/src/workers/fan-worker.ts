/**
 * Fan worker — picks up threshold-crossed streams, runs anti-abuse checks,
 * persists fraud score + signals, and either:
 *   - creates a pending Payment (eligible)
 *   - raises the stream to manual review (manualReview)
 *   - skips (auto-reject fraud, already charged, etc.)
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES, enqueue } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger, getEnv } from '@pazzera/core';
import {
  decideFan,
  type FanStreamContext,
} from '../fan/decide';

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
          deviceFingerprint: true,
        },
      });
      if (!stream) {
        logger.warn({ streamId }, 'fan:stream_missing');
        return;
      }

      // Compute activeMs (excludes pauses) and largeSeekCount from server-recorded ticks
      let activeMs = 0;
      let lastTickMonotonic = stream.ticks[0]?.monotonicMs ?? stream.startedAt.getTime();
      let largeSeekCount = 0;
      for (let i = 1; i < stream.ticks.length; i++) {
        const prev = stream.ticks[i - 1]!;
        const cur = stream.ticks[i]!;
        if (!prev.wasPause && !cur.wasPause) {
          activeMs += Number(cur.monotonicMs - lastTickMonotonic);
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

      // User history snapshot
      const now = Date.now();
      const [streamsLast1h, streamsLast24h, uniqueDevicesLast7d, uniqueIpsLast7d, priorFraudAgg, user] =
        await Promise.all([
          prisma.stream.count({
            where: {
              userId: stream.userId,
              startedAt: { gte: new Date(now - 60 * 60 * 1000) },
            },
          }),
          prisma.stream.count({
            where: {
              userId: stream.userId,
              startedAt: { gte: new Date(now - 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.deviceFingerprint.count({
            where: {
              userId: stream.userId,
              lastSeenAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.stream
            .findMany({
              where: {
                userId: stream.userId,
                startedAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
              },
              select: { ipAddress: true },
              distinct: ['ipAddress'],
            })
            .then((rows) => rows.filter((r) => r.ipAddress).length),
          prisma.stream.aggregate({
            where: { userId: stream.userId, fraudScore: { gt: 0 } },
            _avg: { fraudScore: true },
          }),
          prisma.user.findUnique({
            where: { id: stream.userId },
            select: { createdAt: true },
          }),
        ]);

      // Device fingerprint → user count (other users sharing this fingerprint)
      let deviceFingerprintUserCount = 0;
      if (stream.deviceFingerprintId) {
        // a fingerprint can be associated with multiple users if shared
        deviceFingerprintUserCount = await prisma.deviceFingerprint.count({
          where: {
            id: stream.deviceFingerprintId,
            userId: { not: stream.userId },
          },
        });
        // +1 for the current user
        deviceFingerprintUserCount += 1;
      }

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
          monotonicMs: Number(t.monotonicMs),
          positionSec: t.positionSec,
          wasSeek: t.wasSeek,
          wasPause: t.wasPause,
          wasMuted: t.wasMuted,
          wasHidden: t.wasHidden,
          wasLooped: t.wasLooped,
          audioElementVolume: t.audioElementVolume,
        })),
        largeSeekCount,
        activeMs,
        hasRecentConcurrentStream: concurrent > 0,
        userHistory: {
          streamsLast1h,
          streamsLast24h,
          uniqueDevicesLast7d,
          uniqueIpsLast7d,
          priorFraudScoreAvg: priorFraudAgg._avg.fraudScore ?? 0,
          accountAgeDays: user
            ? Math.floor((now - user.createdAt.getTime()) / (24 * 60 * 60 * 1000))
            : 0,
        },
        ipAddress: stream.ipAddress,
        deviceFingerprintId: stream.deviceFingerprintId,
        deviceFingerprintUserCount,
      };

      const decision = decideFan({ streamId }, ctx);

      // Persist stream fraud score + signals
      await prisma.stream.update({
        where: { id: stream.id },
        data: {
          fraudScore: decision.fraudScore,
          fraudSignals: decision.signals as unknown as object,
          manualReview: decision.manualReview,
          manualReviewReason: decision.manualReview ? decision.reason : null,
        },
      });

      await prisma.agentLog.create({
        data: {
          agent: 'fan',
          streamId: stream.id,
          decision: decision.shouldCharge
            ? 'charge'
            : decision.manualReview
              ? 'manual_review'
              : 'skip',
          reason: decision.reason,
          scoreBreakdown: { fraudScore: decision.fraudScore } as unknown as object,
          payloadJson: { ctx, signals: decision.signals } as unknown as object,
        },
      });

      // Manual review: create a queue row + flag stream
      if (decision.manualReview) {
        await prisma.manualReview.upsert({
          where: { streamId: stream.id },
          create: {
            streamId: stream.id,
            songId: stream.songId,
            subjectUserId: stream.userId,
            fraudScore: decision.fraudScore,
            fraudSignals: decision.signals as unknown as object,
            status: 'pending',
          },
          update: {
            fraudScore: decision.fraudScore,
            fraudSignals: decision.signals as unknown as object,
            status: 'pending',
          },
        });
        await prisma.payment
          .upsert({
            where: { streamId: stream.id },
            create: {
              streamId: stream.id,
              songId: stream.songId,
              payerUserId: stream.userId,
              amountUsdc: stream.song.publishedPriceUsdc ?? '0',
              amountBaseUnits: '0',
              status: 'manual_review',
            },
            update: { status: 'manual_review' },
          })
          .catch(() => undefined);
        logger.warn(
          { streamId, fraudScore: decision.fraudScore },
          'fan:manual_review',
        );
        return;
      }

      if (!decision.shouldCharge) {
        logger.info({ streamId, reason: decision.reason }, 'fan:skip');
        return;
      }

      // Eligible → create a pending Payment row
      const env = getEnv();
      const priceUsdc = stream.song.publishedPriceUsdc ?? '0';
      const amountBaseUnits = BigInt(
        Math.floor(Number(priceUsdc) * 10 ** env.USDC_DECIMALS),
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

      logger.info(
        { streamId, amountBaseUnits, fraudScore: decision.fraudScore },
        'fan:charge_ready',
      );
      // The realtime gateway will pick up the pending state and emit
      // stream:payment_due with the actual amount + recipient.
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
  if (payment.status !== 'pending') return null;

  const env = getEnv();
  const nonce = `0x${Array.from(new Uint8Array(32), () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('')}` as `0x${string}`;

  return {
    streamId,
    songId: stream.songId,
    amountUsdc: stream.song.publishedPriceUsdc ?? '0',
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