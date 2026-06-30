/**
 * Fan worker — pulls `agent:fan` jobs (one per stream).
 *
 * Phase 7: uses v2 decision (classification, fraudScore, shouldCharge),
 * persists a full AgentDecisionLog row, auto-creates a ManualReview row
 * when classification is 'fraudulent_stream' or 'suspicious_stream'.
 *
 * Stream telemetry is fed from PlaybackTick aggregates at job time.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger } from '@pazzera/core';
import { decideFan, type FanInput } from '../fan/decide';
import { recordDecision } from '../utils/record-decision';
import { AgentHealthTracker } from '../utils/agent-health';

const tracker = new AgentHealthTracker(prisma, 'fan');

async function loadStreamSignals(streamId: string): Promise<FanInput | null> {
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    include: {
      song: { select: { durationSeconds: true } },
      user: { select: { id: true, createdAt: true } },
      ticks: true,
    },
  });
  if (!stream) return null;

  // Telemetry aggregates from ticks
  const ticks = stream.ticks;
  let listen = 0, muted = 0, hidden = 0;
  let seekCount = 0, loopCount = 0, maxRate = 1;
  const positions: number[] = [];
  for (const t of ticks) {
    const dt = t.audioElementVolume ?? 1; // simplified
    if (t.wasMuted) muted += dt; else listen += dt;
    if (t.wasHidden) hidden += dt;
    if (t.wasSeek) seekCount += 1;
    if (t.wasLooped) loopCount += 1;
    if ((t as unknown as { playbackRate?: number }).playbackRate ?? 1 > maxRate) {
      maxRate = (t as unknown as { playbackRate?: number }).playbackRate ?? 1;
    }
    positions.push(t.positionSec);
  }

  // Device-fingerprint sharing
  let deviceSharedUsers = 0;
  if (stream.deviceFingerprintId) {
    deviceSharedUsers = await prisma.stream.findMany({
      where: { deviceFingerprintId: stream.deviceFingerprintId, userId: { not: stream.userId } },
      distinct: ['userId'],
      select: { userId: true },
    }).then((rows: { userId: string }[]) => rows.length);
  }

  // IP sharing
  let ipSharedUsers = 0;
  if (stream.ipAddress) {
    ipSharedUsers = await prisma.stream.findMany({
      where: { ipAddress: stream.ipAddress, userId: { not: stream.userId }, startedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      distinct: ['userId'],
      select: { userId: true },
    }).then((rows: { userId: string }[]) => rows.length);
  }

  // Prior charges today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const priorCharges = await prisma.stream.count({
    where: {
      userId: stream.userId,
      songId: stream.songId,
      id: { not: stream.id },
      charged: true,
      startedAt: { gte: todayStart },
    },
  });

  const accountAgeDays = Math.max(0, (Date.now() - stream.user.createdAt.getTime()) / (1000 * 86400));

  return {
    streamId: stream.id,
    songId: stream.songId,
    userId: stream.userId,
    songDurationSeconds: stream.song.durationSeconds,
    listenDurationSec: Math.round(listen),
    mutedDurationSec: Math.round(muted),
    hiddenDurationSec: Math.round(hidden),
    seekCount,
    loopCount,
    maxPlaybackRate: maxRate,
    deviceFingerprintSharedWithUsers: deviceSharedUsers,
    ipSharedWithUsersLast24h: ipSharedUsers,
    userPriorChargesForSongLast24h: priorCharges,
    userAccountAgeDays: accountAgeDays,
    thresholdPct: 25, // matches phase 5 stickyPlayer
  };
}

export async function runFanWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentFan,
    async (job: Job) => {
      const { streamId } = job.data as { streamId: string };
      const started = Date.now();
      await tracker.inProgress();
      try {
        const input = await loadStreamSignals(streamId);
        if (!input) {
          logger.warn({ streamId }, 'fan:stream_missing');
          await tracker.success(Date.now() - started);
          return;
        }

        const decision = decideFan(input);

        // Persist
        await prisma.stream.update({
          where: { id: streamId },
          data: {
            classification: decision.classification,
            fraudScore: decision.fraudScore,
            flaggedAbuse: decision.fraudScore >= 50,
            fraudSignals: JSON.parse(JSON.stringify(decision.signals)),
            manualReview: decision.classification === 'fraudulent_stream' || decision.classification === 'suspicious_stream',
            manualReviewReason: decision.classification === 'fraudulent_stream' ? 'Fraud Sentinel agent flagged as fraudulent' : 'Fan Agent low trust',
            listenDurationSec: input.listenDurationSec,
            mutedDurationSec: input.mutedDurationSec,
            hiddenDurationSec: input.hiddenDurationSec,
            seekCount: input.seekCount,
            loopCount: input.loopCount,
            maxPlaybackRate: input.maxPlaybackRate,
            paymentTriggered: decision.shouldCharge,
            paymentTriggerSec: decision.paymentTriggerSec,
          },
        });

        if (decision.classification === 'fraudulent_stream' || decision.classification === 'suspicious_stream') {
          await prisma.manualReview.upsert({
            where: { streamId },
            create: {
              streamId,
              songId: input.songId,
              subjectUserId: input.userId,
              fraudScore: decision.fraudScore,
              fraudSignals: JSON.parse(JSON.stringify(decision.signals)),
              status: 'pending',
            },
            update: {
              fraudScore: decision.fraudScore,
              fraudSignals: JSON.parse(JSON.stringify(decision.signals)),
            },
          });
        }

        await recordDecision({
          prisma,
          agent: 'fan',
          subject: { type: 'stream', id: streamId },
          input,
          decision: decision.classification,
          confidence: Math.max(0, 100 - decision.fraudScore),
          reasons: decision.reasons,
          categoryScores: decision.signals,
          latencyMs: Date.now() - started,
          crossLinks: { streamId, songId: input.songId, userId: input.userId },
        });

        // Phase 8 — when Fan Agent says shouldCharge, fire payment_due over Socket.IO.
        // The realtime server also writes a PaymentNonce + PaymentEvent row; idempotency
        // is enforced by the consumeNonce() check on settlement.
        if (decision.shouldCharge) {
          try {
            const { emitPaymentDue, issueAndStoreNonce } = await import('@pazzera/realtime');
            const song = await prisma.song.findUnique({
              where: { id: input.songId },
              select: { publishedPriceUsdc: true },
            });
            const amountUsdc = song?.publishedPriceUsdc ?? decision.signals.suggestedPriceUsdc ?? '0.003';
            const tier = ((['0.001', '0.002', '0.003', '0.004', '0.005'] as const).find((t) => Number.parseFloat(t) === Number.parseFloat(amountUsdc)) ?? '0.003') as '0.001' | '0.002' | '0.003' | '0.004' | '0.005';
            const nonce = await issueAndStoreNonce({ streamId, userId: input.userId, amountUsdc });
            await emitPaymentDue({
              streamId,
              songId: input.songId,
              amountUsdc,
              pricingTier: tier,
              authorizationRequired: true,
              nonce,
            });
            await prisma.paymentEvent.create({
              data: {
                kind: 'payment_due',
                streamId,
                songId: input.songId,
                userId: input.userId,
                amountUsdc,
                severity: 0,
                meta: { nonce, classification: decision.classification },
              },
            }).catch(() => undefined);
          } catch (err) {
            logger.warn({ err }, 'fan:payment_due_emit_failed');
          }
        }

        await tracker.success(Date.now() - started);
        logger.info({ streamId, classification: decision.classification, fraudScore: decision.fraudScore }, 'fan:done');
      } catch (err) {
        logger.error({ err, streamId }, 'fan:failed');
        await tracker.failure(Date.now() - started);
        throw err;
      }
    },
    { connection: getQueueConnection(), concurrency: 8 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'fan:failed'));
  return worker;
}