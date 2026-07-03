/**
 * Split worker — pulls `agent:split` jobs for a settled Payment.
 *
 * Reads recipients from RoyaltyRecipient (per song), computes the
 * allocation per recipient using the pure decideSplit function,
 * persists Payout rows + LedgerEntry pairs, then marks the Payment
 * "distributed" with reconciliation metadata.
 *
 * Phase 7: emits AgentDecisionLog with the full split breakdown so
 * admins can click a payout row in the dashboard and see the AI
 * Explainability card.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger } from '@pazzera/core';
import { usdcToBaseUnits } from '@pazzera/blockchain/adapters/usdc';
import { decideSplit, type SplitInput } from '../split/decide';
import { recordDecision } from '../utils/record-decision';
import { AgentHealthTracker } from '../utils/agent-health';

const tracker = new AgentHealthTracker(prisma, 'split');

export async function runSplitWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentSplit,
    async (job: Job) => {
      const { paymentId } = job.data as { paymentId: string };
      const started = Date.now();
      await tracker.inProgress();
      try {
        const payment = await prisma.payment.findUnique({
          where: { id: paymentId },
          include: {
            song: { include: { recipients: true } },
            payouts: { include: { ledgerEntry: true } },
          },
        });
        if (!payment) {
          logger.warn({ paymentId }, 'split:payment_missing');
          await tracker.success(Date.now() - started);
          return;
        }
        if (payment.payouts.length > 0) {
          // Already split → record reconcile only, do not double-mint payouts
          const input: SplitInput = {
            paymentId,
            grossAmountUsdc: payment.amountUsdc,
            recipients: payment.song.recipients.map((r: {
              username: string;
              role: string;
              splitPercentageBps: number;
              payoutPriority: number;
            }) => ({
              username: r.username,
              role: r.role,
              splitPercentageBps: r.splitPercentageBps,
              payoutPriority: r.payoutPriority,
              payoutId: payment.payouts.find((p: { recipientUsername: string }) => p.recipientUsername === r.username)?.id,
              status: (payment.payouts.find((p) => p.recipientUsername === r.username)?.status as
                | 'pending' | 'processing' | 'completed' | 'failed' | undefined) ?? 'pending',
            })),
          };
          const decision = decideSplit(input);
          await recordDecision({
            prisma,
            agent: 'split',
            subject: { type: 'payment', id: paymentId },
            input,
            decision: decision.payoutStatus,
            confidence: 95,
            reasons: decision.reasons,
            categoryScores: decision.reconciliation,
            latencyMs: Date.now() - started,
            crossLinks: { paymentId, songId: payment.songId, userId: payment.payerUserId },
          });
          await tracker.success(Date.now() - started);
          return;
        }

        const input: SplitInput = {
          paymentId,
          grossAmountUsdc: payment.amountUsdc,
          recipients: payment.song.recipients.map((r: {
            username: string;
            role: string;
            splitPercentageBps: number;
            payoutPriority: number;
          }) => ({
            username: r.username,
            role: r.role,
            splitPercentageBps: r.splitPercentageBps,
            payoutPriority: r.payoutPriority,
            payoutId: undefined,
            status: 'pending' as const,
          })),
        };

        const decision = decideSplit(input);

        // Materialize Payout rows + ledger entries
        await prisma.$transaction(async (tx) => {
          for (const split of decision.splits) {
            const recipient = payment.song.recipients.find((r: { username: string }) => r.username === split.username);
            if (!recipient) continue;
            const payout = await tx.payout.create({
              data: {
                paymentId,
                recipientUserId: recipient.userId,
                recipientUsername: recipient.username,
                recipientAddress: recipient.externalWalletAddress ?? '',
                recipientRole: recipient.role,
                splitPercentageBps: recipient.splitPercentageBps,
                amountUsdc: split.amountUsdc,
                amountBaseUnits: usdcToBaseUnits(split.amountUsdc).toString(),
                status: 'pending',
              },
            });
            // Resolve the recipient's DCW wallet so we can write both
            // toUserId AND toWalletId on the ledger entry. Without
            // toWalletId, /api/wallet/transactions won't surface this
            // credit to the artist's dashboard — they only see their
            // own Wallet rows.
            const recipientWallet = await tx.wallet.findUnique({
              where: { userId: recipient.userId },
              select: { id: true, address: true },
            });
            await tx.ledgerEntry.create({
              data: {
                paymentId,
                payoutId: payout.id,
                fromAddress: '0x0000000000000000000000000000000000000000',
                fromWalletId: null,
                toAddress: recipientWallet?.address ?? recipient.externalWalletAddress ?? '',
                toUserId: recipient.userId,
                toWalletId: recipientWallet?.id ?? null,
                grossAmountBaseUnits: payment.amountBaseUnits,
                splitAmountBaseUnits: usdcToBaseUnits(split.amountUsdc).toString(),
                direction: 'credit',
                kind: 'royalty_payout',
                status: 'pending',
                memo: `Split for ${recipient.role}`,
                chainTxHash: payment.txHash ?? null,
              },
            });
          }
          await tx.payment.update({
            where: { id: paymentId },
            data: { status: 'distributed', distributedAt: new Date() },
          });
        });

        await recordDecision({
          prisma,
          agent: 'split',
          subject: { type: 'payment', id: paymentId },
          input,
          decision: decision.payoutStatus,
          confidence: 95,
          reasons: decision.reasons,
          categoryScores: decision.reconciliation,
          latencyMs: Date.now() - started,
          crossLinks: { paymentId, songId: payment.songId, userId: payment.payerUserId },
        });

        // Phase 8 — broadcast payment_settled to the listener's stream room so
        // the floating payment toast (Phase 5) can replace the due toast.
        try {
          const { emitPaymentSettled } = await import('@pazzera/realtime');
          await emitPaymentSettled(payment.streamId, {
            paymentId,
            songId: payment.songId,
            amountUsdc: payment.amountUsdc,
            recipientCount: decision.splits.length,
            txHash: payment.txHash ?? 'unknown', // Phase 9 populates this from the FacilitatorService / Circle webhook
            payoutStatus: decision.payoutStatus,
          });
        } catch (err) {
          logger.warn({ err }, 'split:payment_settled_emit_failed');
        }

        await tracker.success(Date.now() - started);
        logger.info({ paymentId, splits: decision.splits.length }, 'split:done');
      } catch (err) {
        logger.error({ err, paymentId }, 'split:failed');
        await tracker.failure(Date.now() - started);
        throw err;
      }
    },
    { connection: getQueueConnection(), concurrency: 6 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'split:failed'));
  return worker;
}