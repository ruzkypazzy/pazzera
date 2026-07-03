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
import { logger, getEnv } from '@pazzera/core';
import { WalletService, FacilitatorService } from '@pazzera/blockchain';
import { newNonce } from '@pazzera/blockchain/services/eip712';
import { decideFan, type FanInput } from '../fan/decide';
import { recordDecision } from '../utils/record-decision';
import { AgentHealthTracker } from '../utils/agent-health';

const tracker = new AgentHealthTracker(prisma, 'fan');

async function loadStreamSignals(streamId: string): Promise<FanInput | null> {
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    include: {
      song: { select: { durationSeconds: true, artistId: true } },
      user: { select: { id: true, createdAt: true } },
      ticks: true,
    },
  });
  if (!stream) return null;

  // Self-play check: is the listener the primary artist or a royalty
  // recipient on this song? Skip the charge if so.
  let selfPlayKind: 'none' | 'primary_artist' | 'featured_recipient' = 'none';
  if (stream.song?.artistId && stream.song.artistId === stream.userId) {
    selfPlayKind = 'primary_artist';
  } else {
    const recipient = await prisma.royaltyRecipient.findFirst({
      where: { songId: stream.songId, userId: stream.userId },
      select: { id: true },
    });
    if (recipient) selfPlayKind = 'featured_recipient';
  }

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
    // Wall-clock elapsed is read straight from the stream row — it's
    // maintained server-side by the aggregator as `effectiveDurationMs`
    // and includes all ticks (visible + hidden + muted). The Fan Agent
    // uses this for the charge threshold so brief tab backgrounding
    // doesn't penalize legitimate listeners.
    effectiveDurationMs: stream.effectiveDurationMs ?? Math.round(listen + muted + hidden) * 1000,
    seekCount,
    loopCount,
    maxPlaybackRate: maxRate,
    deviceFingerprintSharedWithUsers: deviceSharedUsers,
    ipSharedWithUsersLast24h: ipSharedUsers,
    userPriorChargesForSongLast24h: priorCharges,
    userAccountAgeDays: accountAgeDays,
    thresholdPct: 25, // matches phase 5 stickyPlayer
    selfPlayKind,
  };
}

/**
 * Server-side x402 sign-and-settle (Fix 3).
 *
 * Listener wallets are Circle Developer-Controlled Wallets (DCW), so the
 * platform holds the signing material. We:
 *   1. Issue a one-time nonce and emit `payment_due` for UX.
 *   2. Build the EIP-3009 TransferWithAuthorization envelope (from
 *      listener, to song's primary artist, value in USDC base units,
 *      fresh validAfter/validBefore window).
 *   3. Sign via WalletService.signX402Authorization (Circle DCW
 *      POST /v1/w3s/developer/sign/typedData). The per-stream and
 *      daily caps inside that helper raise on overage; we treat
 *      those as payment_failed.
 *   4. Persist a Payment row (status=pending) and call
 *      FacilitatorService.settle() to submit the envelope to Circle
 *      Gateway. The facilitator verifies the signature, submits the
 *      settlement, and the service updates Payment.status='settled'
 *      with the txHash + enqueues the Split worker.
 *   5. Emit `payment_settled` or `payment_failed` to the stream room
 *      using the realtime helpers.
 *
 * The realtime server's old `payment_authorized` handler is kept
 * intact for backward compatibility (other packages import the
 * socket contract types) but is no longer the source of truth.
 */
export async function runSignAndSettle(opts: {
  streamId: string;
  userId: string;
  songId: string;
  amountUsdc: string;
  classification: string;
}): Promise<void> {
  const { streamId, userId, songId, amountUsdc, classification } = opts;
  const env = getEnv();

  // Lazy import — avoids pulling the realtime / blockchain server-only
  // code into any unit-test environment that doesn't have a live DB.
  const { emitPaymentDue, emitPaymentSettled, emitPaymentFailed, issueAndStoreNonce } = await import('@pazzera/realtime');
  const { usdcToBaseUnits } = await import('@pazzera/blockchain/adapters/usdc');

  const tier = ((['0.001', '0.002', '0.003', '0.004', '0.005'] as const).find(
    (t) => Number.parseFloat(t) === Number.parseFloat(amountUsdc),
  ) ?? '0.003') as '0.001' | '0.002' | '0.003' | '0.004' | '0.005';

  // 1. Informational payment_due + nonce. Persists PaymentNonce row.
  const nonce = await issueAndStoreNonce({ streamId, userId, amountUsdc });
  await emitPaymentDue({
    streamId,
    songId,
    amountUsdc,
    pricingTier: tier,
    authorizationRequired: false, // server signs, client doesn't have to
    nonce,
  });

  // 2. Resolve listener wallet + artist wallet.
  const [listenerWallet, song] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.song.findUnique({
      where: { id: songId },
      select: { id: true, artistId: true, publishedPriceUsdc: true },
    }),
  ]);
  if (!listenerWallet || listenerWallet.status !== 'active' || !listenerWallet.address) {
    logger.warn({ streamId, userId }, 'fan:sign_and_settle:no_listener_wallet');
    await emitPaymentFailed(streamId, 'chain_error', 'Listener wallet unavailable');
    return;
  }
  if (!song) {
    logger.warn({ streamId, songId }, 'fan:sign_and_settle:no_song');
    await emitPaymentFailed(streamId, 'chain_error', 'Song not found');
    return;
  }
  const artistWallet = await prisma.wallet.findUnique({ where: { userId: song.artistId } });
  if (!artistWallet || !artistWallet.address) {
    logger.warn({ streamId, songId, artistId: song.artistId }, 'fan:sign_and_settle:no_artist_wallet');
    await emitPaymentFailed(streamId, 'chain_error', 'Artist wallet unavailable');
    return;
  }

  // 3. Build the x402 envelope. Use bytes32 nonce (EIP-712 expects
  // bytes32; the realtime nonce is a friendly opaque string we keep
  // for the audit log; the bytes32 version is derived from it).
  //
  // CRITICAL — Circle Gateway batching uses a DIFFERENT EIP-712 domain
  // than USDC's standard TransferWithAuthorization:
  //   Domain name:    'GatewayWalletBatched' (not 'USDC')
  //   Domain version: '1' (not '2')
  //   verifyingContract: Gateway Wallet (0x0077777d7EBA4688BDeF3E311b846F25870A19B9)
  //                      NOT the USDC contract.
  //
  // Reference: https://developers.circle.com/gateway/nanopayments/references/sdk
  //   createPaymentPayload() signs over this Gateway domain.
  //
  // validBefore must be at least 3 days in the future (Circle SDK
  // reference: authorization_validity_too_short if shorter).
  const validAfter = Math.floor(Date.now() / 1000) - 60;
  const validBefore = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const valueBaseUnits = usdcToBaseUnits(amountUsdc).toString();
  const eip712Nonce = newNonce();

  // 4. Create the Payment row up front so FacilitatorService has a
  // stable id to mark settled. The unique-by-streamId constraint
  // means a second fan-worker run for the same stream would conflict
  // — that's intentional (idempotency).
  let payment;
  try {
    payment = await prisma.payment.create({
      data: {
        streamId,
        songId,
        payerUserId: userId,
        amountUsdc,
        amountBaseUnits: valueBaseUnits,
        status: 'pending',
      },
    });
  } catch (err) {
    logger.warn({ err, streamId }, 'fan:sign_and_settle:payment_create_failed');
    await emitPaymentFailed(streamId, 'chain_error', 'Could not persist payment');
    return;
  }

  await prisma.paymentEvent.create({
    data: {
      kind: 'payment_due',
      paymentId: payment.id,
      streamId,
      songId,
      userId,
      amountUsdc,
      severity: 0,
      meta: { nonce, classification, serverSigned: true },
    },
  }).catch(() => undefined);

  // 5. Sign via DCW. signX402Authorization enforces per-stream +
  // daily caps; on cap-exceeded it throws AppError('CONFLICT'). We
  // treat that as a payment_failed (no retry loop — the helper has
  // already counted it against the daily cap).
  let signed;
  try {
    signed = await WalletService.signX402Authorization({
      userId,
      walletId: listenerWallet.id,
      to: artistWallet.address as `0x${string}`,
      valueBaseUnits,
      validAfter,
      validBefore,
      nonce: eip712Nonce,
      chainId: Number(env.ARC_CHAIN_ID),
      usdcContract: env.USDC_CONTRACT_ADDRESS as `0x${string}`,
      scheme: 'gateway-batched',
    });
  } catch (err: any) {
    logger.warn({ err, streamId, userId }, 'fan:sign_and_settle:sign_failed');
    const reason = err?.code === 'CONFLICT' ? 'rate_limited' : 'chain_error';
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'failed' },
    }).catch(() => undefined);
    await emitPaymentFailed(streamId, reason, err?.message ?? 'Sign failed');
    return;
  }

  // 6. Settle via Circle Gateway facilitator.
  const outcome = await FacilitatorService.settle({
    paymentId: payment.id,
    envelope: {
      from: listenerWallet.address as `0x${string}`,
      to: artistWallet.address as `0x${string}`,
      value: valueBaseUnits,
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce: eip712Nonce,
      v: signed.v,
      r: signed.r,
      s: signed.s,
      asset: env.USDC_CONTRACT_ADDRESS as `0x${string}`,
    },
    nonce,
  });

  if (!outcome.ok) {
    logger.warn({ streamId, paymentId: payment.id, reason: outcome.reason }, 'fan:sign_and_settle:settle_failed');
    // Defensive: FacilitatorService.settle() already marks the row
    // failed via recordFailure, but we update it here too so the
    // Payment row is consistent even if the helper is mocked or the
    // helper path is bypassed.
    await prisma.payment
      .update({
        where: { id: payment.id },
        data: { status: 'failed' },
      })
      .catch(() => undefined);
    await emitPaymentFailed(
      streamId,
      outcome.reason === 'insufficient_balance' ? 'insufficient_balance' : 'chain_error',
      outcome.reason ?? 'settle_failed',
    );
    return;
  }

  logger.info(
    {
      streamId,
      paymentId: payment.id,
      txHash: outcome.txHash,
      blockNumber: outcome.blockNumber,
      amountUsdc,
    },
    'fan:sign_and_settle:settled',
  );

  await emitPaymentSettled(streamId, {
    paymentId: payment.id,
    songId,
    amountUsdc,
    recipientCount: 0, // split worker fills this in after fanout
    txHash: outcome.txHash!,
    payoutStatus: 'pending',
  });
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

        // Increment playCount for any non-fraudulent stream. Self-play
        // streams still count as plays (the artist was listening) but
        // are also flagged so the dashboard can show "self-listens".
        const isCountedPlay =
          decision.classification !== 'fraudulent_stream' &&
          decision.classification !== 'suspicious_stream';
        if (isCountedPlay) {
          await prisma.song.update({
            where: { id: input.songId },
            data: { playCount: { increment: 1 } },
          });
        }

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
          // Server-side sign-and-settle (Fix 3). The listener uses a
          // Circle Developer-Controlled Wallet, so the platform holds
          // the signing keys — there is no client-side signing. We
          // build the x402 envelope, sign it via WalletService, persist
          // a Payment row, then call FacilitatorService.settle() to
          // submit the EIP-3009 TransferWithAuthorization to Circle
          // Gateway. payment_due is still emitted to the listener for
          // UX, but it is informational only — the actual settle runs
          // here.
          await runSignAndSettle({
            streamId,
            userId: input.userId,
            songId: input.songId,
            amountUsdc: String(
              (
                await prisma.song.findUnique({
                  where: { id: input.songId },
                  select: { publishedPriceUsdc: true },
                })
              )?.publishedPriceUsdc ?? decision.signals.suggestedPriceUsdc ?? '0.003',
            ),
            classification: decision.classification,
          }).catch((err) => {
            logger.warn({ err, streamId }, 'fan:sign_and_settle_failed');
          });
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