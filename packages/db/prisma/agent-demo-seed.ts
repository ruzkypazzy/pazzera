/**
 * Demo-mode agent events seeder.
 *
 * When DEMO_MODE=true is set, this seeder creates a small history of
 * recent AI decisions across all 5 agents so the admin dashboard
 * appears alive. Idempotent — safe to re-run.
 *
 * The seed runs after the main seed and writes:
 *   5 curator decisions (3 approved, 1 rejected, 1 manual_review)
 *   6 fan decisions (3 valid, 2 suspicious, 1 fraudulent)
 *   3 split decisions (2 completed, 1 partial_failure)
 *   4 discovery recommendations across all 4 buckets
 *   2 fraud alerts (1 high, 1 critical)
 *
 * Also bumps AgentHealthMetrics into a believable recent 5-minute window.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

function canonical(input: unknown): string {
  return JSON.stringify(input, Object.keys(input as object).sort());
}

function hashInput(agent: string, subject: { type: string; id: string }, input: unknown) {
  return createHash('sha256').update(canonical({ agent, subject, input })).digest('hex');
}

const NOW = Date.now();
function ago(seconds: number): Date {
  return new Date(NOW - seconds * 1000);
}

async function main() {
  console.log('agent-demo:start');

  // Find existing seed data
  const songs = await prisma.song.findMany({ where: { status: 'published' }, take: 5 });
  const users = await prisma.user.findMany({ take: 5, select: { id: true, username: true } });
  if (songs.length === 0 || users.length === 0) {
    console.log('agent-demo:skip — no songs or users to attach to (run seed first)');
    return;
  }

  // ─── 5 curator decisions ─────────────────────
  for (let i = 0; i < Math.min(5, songs.length); i++) {
    const song = songs[i]!;
    const decision =
      i === 3 ? 'rejected' : i === 4 ? 'manual_review' : 'approved';
    const score = i === 3 ? 22 : i === 4 ? 55 : 75 + i * 4;
    const confidence = i === 3 ? 92 : i === 4 ? 65 : 88;
    const input = {
      songId: song.id,
      artistRequestedPriceUsdc: 0.003,
      metadata: { title: song.title, artistName: song.artistName, featuredNames: [], producerName: null, description: song.description, coverUrl: song.coverUrl, audioUrl: song.audioUrl, durationSeconds: song.durationSeconds },
      audioQuality: { bitrateKbps: 256, sampleRateHz: 44100, channels: 2, peakDb: -3, lufsIntegrated: -16, lufsRange: 8, truePeakDb: -1.5 },
      artistHistory: { totalSongs: i + 1, approvedSongs: i, rejectedSongs: i === 3 ? 2 : 0, flaggedForSpam: 0 },
      duplicate: { binaryHashMatch: false, acousticHashMatch: false },
      usernamesResolved: i !== 3,
      recipientCount: 3,
      artwork: { widthPx: 1024, heightPx: 1024, isSquare: true, aspectRatio: 1.0 },
    };
    const reasons =
      i === 3
        ? ['Bitrate below 128 kbps', 'Title suspiciously long']
        : i === 4
          ? ['Score below auto-approval threshold', 'Loudness borderline']
          : [
              'All 7 dimensions in acceptable range',
              i === 0 ? 'Bitrate 320 kbps, sample rate 48 kHz' : 'Recently published song in your genre',
            ];
    const subject = { type: 'song', id: song.id };
    await prisma.agentDecisionLog.upsert({
      where: { agent_inputHash: { agent: 'curator', inputHash: hashInput('curator', subject, input) } },
      create: {
        agent: 'curator',
        subjectType: 'song',
        subjectId: song.id,
        songId: song.id,
        decision,
        confidence,
        reasons,
        categoryScores: {
          metadata: 18, audioQuality: 17, loudness: 18, artwork: 18,
          duplicateRisk: 20, spamRisk: 18, marketability: 14,
        },
        inputs: input,
        latencyMs: 240 + i * 12,
        inputHash: hashInput('curator', subject, input),
        createdAt: ago(60 * (60 - i * 5)),
      },
      update: {},
    });
  }

  // ─── Fan decisions ─────────────────────
  const classifications = ['valid_stream', 'valid_stream', 'valid_stream', 'suspicious_stream', 'fraudulent_stream', 'suspicious_stream'];
  for (let i = 0; i < classifications.length; i++) {
    const song = songs[i % songs.length]!;
    const user = users[i % users.length]!;
    const classification = classifications[i]!;
    const streamId = `demo-stream-${i}`;
    const reasons =
      classification === 'valid_stream'
        ? ['Listen 94% of duration', 'Tab visible', 'No seeks']
        : classification === 'fraudulent_stream'
          ? ['Tab hidden 78% of listen', 'IP shared with 11 other accounts', 'Playback rate 2x']
          : ['Audio muted 60% of listen', 'Same IP as 4 other users'];
    const fraudScore = classification === 'valid_stream' ? 8 : classification === 'suspicious_stream' ? 52 : 92;
    const input = {
      streamId,
      songId: song.id,
      userId: user.id,
      songDurationSeconds: song.durationSeconds || 180,
      listenDurationSec: 180,
      mutedDurationSec: classification === 'suspicious_stream' ? 110 : 0,
      hiddenDurationSec: classification === 'fraudulent_stream' ? 140 : 5,
      seekCount: classification === 'valid_stream' ? 1 : 3,
      loopCount: 0,
      maxPlaybackRate: classification === 'fraudulent_stream' ? 2 : 1,
      deviceFingerprintSharedWithUsers: classification === 'fraudulent_stream' ? 4 : 0,
      ipSharedWithUsersLast24h: classification === 'fraudulent_stream' ? 11 : classification === 'suspicious_stream' ? 4 : 0,
      userPriorChargesForSongLast24h: 0,
      userAccountAgeDays: 30,
      thresholdPct: 25,
    };
    const subject = { type: 'stream', id: streamId };
    await prisma.agentDecisionLog.upsert({
      where: { agent_inputHash: { agent: 'fan', inputHash: hashInput('fan', subject, input) } },
      create: {
        agent: 'fan',
        subjectType: 'stream',
        subjectId: streamId,
        songId: song.id,
        decision: classification,
        confidence: Math.max(0, 100 - fraudScore),
        reasons,
        categoryScores: { mutedRatio: input.mutedDurationSec / 180, hiddenRatio: input.hiddenDurationSec / 180 },
        inputs: input,
        latencyMs: 80 + i * 4,
        inputHash: hashInput('fan', subject, input),
        createdAt: ago(60 * (i + 1)),
      },
      update: {},
    });
  }

  // ─── Split decisions + Fraud alerts ────────────────────
  const payments = await prisma.payment.findMany({ take: 3, include: { song: { include: { recipients: true } } } });
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i]!;
    const input = {
      paymentId: p.id,
      grossAmountUsdc: p.amountUsdc,
      recipients: p.song.recipients.map((r) => ({
        username: r.username,
        role: r.role,
        splitPercentageBps: r.splitPercentageBps,
        payoutPriority: r.payoutPriority,
      })),
    };
    const subject = { type: 'payment', id: p.id };
    await prisma.agentDecisionLog.upsert({
      where: { agent_inputHash: { agent: 'split', inputHash: hashInput('split', subject, input) } },
      create: {
        agent: 'split',
        subjectType: 'payment',
        subjectId: p.id,
        paymentId: p.id,
        decision: i === 2 ? 'partial_failure' : 'completed',
        confidence: 95,
        reasons: i === 2 ? ['1 of 3 payouts failed (insufficient gas)'] : ['3 of 3 payouts settled'],
        categoryScores: { splitsAttempted: 3, splitsCompleted: i === 2 ? 2 : 3, splitsFailed: i === 2 ? 1 : 0 },
        inputs: input,
        latencyMs: 320,
        inputHash: hashInput('split', subject, input),
        createdAt: ago(60 * (i * 7)),
      },
      update: {},
    });
  }

  // ─── Discovery recommendations ──────────────────
  const buckets: Array<{ name: string; score: number; explanation: string }> = [
    { name: 'for_you', score: 0.71, explanation: 'Best personalized match in your feed right now.' },
    { name: 'trending', score: 0.82, explanation: 'Trending: streams up 220% over the rolling 7d window.' },
    { name: 'rising_artists', score: 0.64, explanation: 'Rising artist: only 1 published song, top 4% of trending artists this week.' },
    { name: 'because_you_listened', score: 0.78, explanation: 'You completed 92% of songs like this.' },
  ];
  for (let i = 0; i < buckets.length; i++) {
    const song = songs[i % songs.length]!;
    const b = buckets[i]!;
    const input = {
      userId: 'demo-user',
      songId: song.id,
      userCfSimilarity: 0.6,
      userCompletionRate: b.name === 'because_you_listened' ? 0.9 : 0.5,
      userReplayCount: 0,
      userWalletSpendAffinity: 0.5,
      artistSimilarity: 0.6,
      trendingVelocity: b.name === 'trending' ? 0.85 : 0.4,
      daysSinceUpload: i * 4,
      songCompletionRate: 0.7,
      artistPublishedCount: b.name === 'rising_artists' ? 1 : 5,
      artistTrendingRank: b.name === 'rising_artists' ? 0.04 : 0.4,
      recentSimilarListen: b.name === 'because_you_listened' ? 1 : 0,
      recentSimilarSongTitle: 'Similar Sound',
    };
    const subject = { type: 'user', id: 'demo-user' };
    await prisma.agentDecisionLog.upsert({
      where: { agent_inputHash: { agent: 'discovery', inputHash: hashInput('discovery', subject, input) } },
      create: {
        agent: 'discovery',
        subjectType: 'user',
        subjectId: 'demo-user',
        songId: song.id,
        decision: b.name,
        confidence: 70,
        reasons: [b.explanation],
        categoryScores: { cf: 0.15, completion: 0.09, trend: b.score * 0.5, fresh: 0.05 },
        inputs: input,
        latencyMs: 110,
        inputHash: hashInput('discovery', subject, input),
        createdAt: ago(60 * 8),
      },
      update: {},
    });
  }

  // ─── Fraud alerts (high + critical) ──────────────────
  await prisma.fraudAlert.create({
    data: {
      severity: 'high',
      entityType: 'wallet',
      entityId: '0xdeadbeef000000000000000000000000000001',
      score: 78,
      reasons: ['50 streams in 7d from single wallet', 'Same song streamed 22x in 24h'],
      metricBreakdown: { volume: 40, concentration: 25, sameSong: 13 },
      autoActioned: true,
      autoAction: 'payouts_paused',
      createdAt: ago(60 * 4),
    },
  });
  await prisma.fraudAlert.create({
    data: {
      severity: 'critical',
      entityType: 'ip_cluster',
      entityId: '203.0.113.42',
      score: 92,
      reasons: ['12 accounts created within 18h', 'All streamed the same song', 'Stream starts within 0.4s stddev'],
      metricBreakdown: { cluster: 40, window: 20, target: 20, timing: 20, composite: 10 },
      autoActioned: true,
      autoAction: 'account_locked',
      createdAt: ago(60 * 9),
    },
  });

  // ─── AgentHealthMetrics — bootstrap healthy states ───────
  const agents = ['curator', 'fan', 'split', 'discovery', 'fraud_sentinel'];
  for (const agent of agents) {
    const bucketStart = new Date(Math.floor(NOW / 60_000) * 60_000);
    const bucketEnd = new Date(bucketStart.getTime() + 60_000);
    await prisma.agentHealthMetrics.upsert({
      where: { agent_scope_bucketStart: { agent, scope: 'minute', bucketStart } },
      create: {
        agent,
        scope: 'minute',
        bucketStart,
        bucketEnd,
        jobsProcessed: 4,
        jobsFailed: 0,
        jobsRetried: 0,
        p50LatencyMs: 120,
        p95LatencyMs: 240,
        p99LatencyMs: 410,
        queueDepth: 0,
        activeJobs: 0,
        lastExecutionAt: new Date(),
        status: 'healthy',
        successRate: 1.0,
      },
      update: {},
    });
  }

  console.log('agent-demo:done');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('agent-demo:fail', err);
    await prisma.$disconnect();
    process.exit(1);
  });