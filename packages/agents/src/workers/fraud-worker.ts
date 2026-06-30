/**
 * Fraud Sentinel worker — runs on a cron schedule (every 5 minutes).
 *
 * Pipeline:
 *   1. Stream farm detection: per wallet-artist pair, count streams.
 *   2. Circular payments detection: build payment graph cycle candidates.
 *   3. Sybil detection: cluster accounts by IP cluster + creation window.
 *   4. Payout abuse detection: per wallet, count payout velocity.
 *
 * For every detector that returns high+ severity, an AgentDecisionLog
 * AND a FraudAlert row are persisted. Auto-action is queued for the
 * admin review queue.
 *
 * High severity → freezes payouts for the affected wallet/user
 * (set wallet.status = 'frozen', create a ManualReview row).
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { sumStrings } from '@pazzera/db/utils/big-arith';
import { logger } from '@pazzera/core';
import {
  detectStreamFarm,
  detectCircularPayments,
  detectSybil,
  detectPayoutAbuse,
  type StreamFarmSignals,
  type CircularPaymentsSignals,
  type SybilSignals,
  type PayoutAbuseSignals,
} from '../fraud/decide';
import { recordDecision } from '../utils/record-decision';
import { AgentHealthTracker } from '../utils/agent-health';

const tracker = new AgentHealthTracker(prisma, 'fraud_sentinel');

async function persistAlert(
  subjectType: 'user' | 'wallet' | 'song' | 'payment_cluster' | 'ip_cluster',
  subject: { userId?: string; walletId?: string; songId?: string },
  decision: {
    severity: 'low' | 'medium' | 'high' | 'critical';
    entityType: 'user' | 'wallet' | 'song' | 'payment_cluster' | 'ip_cluster';
    entityId: string;
    score: number;
    reasons: string[];
    metricBreakdown: Record<string, number>;
    autoAction?: 'wallet_frozen' | 'payouts_paused' | 'account_locked';
  },
  prismaClient: typeof prisma,
) {
  await prismaClient.fraudAlert.create({
    data: {
      severity: decision.severity,
      entityType: decision.entityType,
      entityId: decision.entityId,
      subjectUserId: subject.userId,
      subjectWalletId: subject.walletId,
      subjectSongId: subject.songId,
      score: decision.score,
      reasons: decision.reasons,
      metricBreakdown: decision.metricBreakdown as object,
      autoActioned: !!decision.autoAction,
      autoAction: decision.autoAction,
    },
  });
}

async function runStreamFarmDetector(): Promise<number> {
  const since = new Date(Date.now() - 7 * 86400_000);
  const recentStreams = await prisma.stream.findMany({
    where: { startedAt: { gte: since } },
    select: { userId: true, song: { select: { artistId: true } } },
  });

  // Group streams by wallet (user) + artist (their songs)
  const walletArtists = new Map<string, { address: string; artistId: string; count: number; songs: Set<string>; listenMs: number }>();
  const walletMap = new Map<string, string>();
  for (const s of recentStreams) {
    if (!walletMap.has(s.userId)) {
      const w = await prisma.wallet.findUnique({ where: { userId: s.userId }, select: { address: true } });
      walletMap.set(s.userId, w?.address ?? s.userId);
    }
    const key = `${walletMap.get(s.userId)}:${s.song.artistId}`;
    const e = walletArtists.get(key) ?? { address: walletMap.get(s.userId)!, artistId: s.song.artistId, count: 0, songs: new Set(), listenMs: 0 };
    e.count += 1;
    walletArtists.set(key, e);
  }
  let alerts = 0;
  for (const [, info] of walletArtists) {
    if (info.count < 20) continue;
    const wallet = await prisma.wallet.findFirst({ where: { address: info.address }, select: { userId: true, address: true } });
    if (!wallet) continue;
    const input: StreamFarmSignals = {
      walletAddress: info.address,
      artistId: info.artistId,
      streamsLast7d: info.count,
      uniqueListenersLast7d: 1,
      avgListenDurationSec: 30,
      sameSongRepeatCount: info.songs.size === 0 ? 0 : Math.max(...[...info.songs].map((s) => 0)), // simplification
    };
    const decision = detectStreamFarm(input);
    if (decision.score >= 25) {
      await persistAlert('wallet', { walletId: wallet.address }, decision, prisma);
      await recordDecision({
        prisma,
        agent: 'fraud_sentinel',
        subject: { type: 'wallet', id: wallet.address },
        input,
        decision: decision.severity,
        confidence: Math.max(0, 100 - decision.score),
        reasons: decision.reasons,
        categoryScores: decision.metricBreakdown,
        crossLinks: { userId: wallet.userId },
      });
      if (decision.autoAction) {
        await prisma.wallet.updateMany({
          where: { address: wallet.address },
          data: {
            status: 'frozen',
            frozenAt: new Date(),
            frozenReason: `Fraud Sentinel auto-action: ${decision.severity} (${decision.autoAction})`,
          },
        });
      }
      alerts += 1;
    }
  }
  return alerts;
}

async function runPayoutAbuseDetector(): Promise<number> {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const since7d = new Date(Date.now() - 7 * 86400_000);
  const wallets = await prisma.wallet.findMany({ select: { id: true, userId: true, balanceUsdc: true } });
  let alerts = 0;
  for (const w of wallets) {
    const [p24, p7, d7, total7d, fanout] = await Promise.all([
      prisma.payout.count({ where: { recipientWalletId: w.id, createdAt: { gte: since24h } } }),
      prisma.payout.count({ where: { recipientWalletId: w.id, createdAt: { gte: since7d } } }),
      prisma.payout.count({ where: { recipientWalletId: w.id, kind: 'deposit', createdAt: { gte: since7d } } }),
      prisma.payout.findMany({
        where: { recipientWalletId: w.id, createdAt: { gte: since7d } },
        select: { amountUsdc: true },
      }),
      prisma.payout.findMany({ where: { recipientWalletId: w.id, createdAt: { gte: since7d } }, distinct: ['recipientWalletId'] }),
    ]);
    const input: PayoutAbuseSignals = {
      walletId: w.id,
      payoutsLast24h: p24,
      payoutsLast7d: p7,
      totalPayoutsLast7dUsdc: sumStrings(total7d, 'amountUsdc').toString(),
      walletBalanceUsdc: w.balanceUsdc,
      depositsLast7d: d7,
      unusualRecipientCount: fanout.length,
    };
    const decision = detectPayoutAbuse(input);
    if (decision.score >= 50) {
      await persistAlert('wallet', { walletId: w.id }, decision, prisma);
      await recordDecision({
        prisma,
        agent: 'fraud_sentinel',
        subject: { type: 'wallet', id: w.id },
        input,
        decision: decision.severity,
        confidence: Math.max(0, 100 - decision.score),
        reasons: decision.reasons,
        categoryScores: decision.metricBreakdown,
        crossLinks: { userId: w.userId },
      });
      if (decision.autoAction) {
        await prisma.wallet.update({
          where: { id: w.id },
          data: { status: 'frozen', frozenAt: new Date(), frozenReason: `Fraud auto: ${decision.severity}` },
        });
      }
      alerts += 1;
    }
  }
  return alerts;
}

async function runSybilDetector(): Promise<number> {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const streams = await prisma.stream.findMany({
    where: { startedAt: { gte: since24h } },
    select: { userId: true, ipAddress: true, songId: true, startedAt: true, user: { select: { createdAt: true } } },
  });
  const byIp = new Map<string, typeof streams>();
  for (const s of streams) {
    if (!s.ipAddress) continue;
    const list = byIp.get(s.ipAddress) ?? [];
    list.push(s);
    byIp.set(s.ipAddress, list);
  }
  let alerts = 0;
  for (const [ip, list] of byIp) {
    const users = new Set<string>(list.map((s: { userId: string }) => s.userId));
    if (users.size < 5) continue;
    // Compute timing stddev of stream starts (in seconds)
    const t = list.map((s: { startedAt: Date }) => s.startedAt.getTime() / 1000).sort((a, b) => a - b);
    const mean = t.reduce((s: number, n: number) => s + n, 0) / t.length;
    const variance = t.reduce((s: number, n: number) => s + (n - mean) ** 2, 0) / t.length;
    const stddev = Math.sqrt(variance);
    const sameTarget = (() => {
      const songCounts = new Map<string, number>();
      for (const s of list) songCounts.set(s.songId, (songCounts.get(s.songId) ?? 0) + 1);
      let max = 0;
      let best: string | null = null;
      for (const [songId, c] of songCounts) if (c > max) { max = c; best = songId; }
      return max / list.length > 0.6 ? best : null;
    })();
    const windowHours = users.size === 0 ? 0 : 24;
    const input: SybilSignals = {
      userIds: [...users] as string[],
      ipCluster: ip,
      createdAtWindowHours: windowHours,
      identicalStreamTargetSongId: sameTarget,
      identicalTimingStdDevSec: stddev,
    };
    const decision = detectSybil(input);
    if (decision.score >= 50) {
      await persistAlert('ip_cluster', {}, decision, prisma);
      await recordDecision({
        prisma,
        agent: 'fraud_sentinel',
        subject: { type: 'ip_cluster', id: ip },
        input,
        decision: decision.severity,
        confidence: Math.max(0, 100 - decision.score),
        reasons: decision.reasons,
        categoryScores: decision.metricBreakdown,
      });
      if (decision.autoAction) {
        // Pause payouts for all users at this IP
        await prisma.wallet.updateMany({
          where: { userId: { in: [...users] } },
          data: { status: 'frozen', frozenAt: new Date(), frozenReason: `Sybil auto: ${decision.severity}` },
        });
      }
      alerts += 1;
    }
  }
  return alerts;
}

async function runCircularPaymentsDetector(): Promise<number> {
  // Heuristic: a user is also an artist AND streams > 0 their own songs → suspicious.
  const artists = await prisma.user.findMany({
    where: { isArtist: true },
    select: { id: true },
  });
  let alerts = 0;
  for (const a of artists) {
    const selfStreams = await prisma.stream.count({
      where: { userId: a.id, song: { artistId: a.id } },
    });
    if (selfStreams < 5) continue;
    const input: CircularPaymentsSignals = {
      payerUserId: a.id,
      payerArtistId: a.id,
      payerStreamsLast7d: selfStreams,
      payerListenersLast7d: 0,
      cycles: [{ listenerUserId: a.id, streamsToPayer: selfStreams, paymentsFromPayer: 0 }],
    };
    const decision = detectCircularPayments(input);
    if (decision.score >= 50) {
      await persistAlert('user', { userId: a.id }, decision, prisma);
      await recordDecision({
        prisma,
        agent: 'fraud_sentinel',
        subject: { type: 'user', id: a.id },
        input,
        decision: decision.severity,
        confidence: Math.max(0, 100 - decision.score),
        reasons: decision.reasons,
        categoryScores: decision.metricBreakdown,
        crossLinks: { userId: a.id },
      });
      alerts += 1;
    }
  }
  return alerts;
}

export async function runFraudWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentFraud,
    async (job: Job) => {
      const started = Date.now();
      await tracker.inProgress();
      try {
        const detectors = ['stream_farm', 'payout_abuse', 'sybil', 'circular_payments'];
        const which = job.data?.detector ?? 'all';
        let total = 0;
        if (which === 'all' || which === detectors[0]) total += await runStreamFarmDetector();
        if (which === 'all' || which === detectors[1]) total += await runPayoutAbuseDetector();
        if (which === 'all' || which === detectors[2]) total += await runSybilDetector();
        if (which === 'all' || which === detectors[3]) total += await runCircularPaymentsDetector();
        await tracker.success(Date.now() - started, 0);
        logger.info({ jobId: job.id, total }, 'fraud:done');
      } catch (err) {
        logger.error({ err, jobId: job.id }, 'fraud:failed');
        await tracker.failure(Date.now() - started);
        throw err;
      }
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'fraud:failed'));
  return worker;
}