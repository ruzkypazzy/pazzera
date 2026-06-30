/**
 * Split worker — picks up settled Payment rows, resolves recipient wallets
 * (internal User.wallet OR external RoyaltyRecipient.externalWalletAddress),
 * distributes on-chain USDC transfers per recipient, writes Payout rows,
 * and writes double-entry LedgerEntry rows.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger, getEnv, BlockchainError } from '@pazzera/core';
import {
  getArcWalletClient,
  waitForReceipt,
} from '@pazzera/blockchain';
import { encodeTransfer } from '@pazzera/blockchain/usdc';
import { decideSplit, type SplitRecipient } from '../split/decide';

export async function runSplitWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentSplit,
    async (job: Job) => {
      const { paymentId } = job.data as { paymentId: string };
      logger.info({ paymentId, jobId: job.id }, 'split:start');

      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          song: { include: { recipients: true } },
          payer: { include: { wallet: true } },
        },
      });
      if (!payment) return;
      if (payment.status !== 'settled') {
        logger.info({ paymentId, status: payment.status }, 'split:not_settled');
        return;
      }

      // Resolve recipients — joins user wallet if internal
      const userIds = payment.song.recipients
        .filter((r) => r.userId !== null)
        .map((r) => r.userId!);
      const wallets = await prisma.wallet.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, address: true },
      });
      const walletByUserId = new Map(wallets.map((w) => [w.userId, w.address]));

      const splitRecipients: SplitRecipient[] = payment.song.recipients.map((r) => ({
        username: r.username,
        walletAddress: r.userId ? walletByUserId.get(r.userId) ?? null : null,
        externalAddress: r.externalWalletAddress,
        recipientUserId: r.userId,
        role: r.role,
        bps: r.splitPercentageBps,
        payoutPriority: r.payoutPriority,
      }));

      if (splitRecipients.length === 0) {
        throw new BlockchainError('Song has no recipients', {
          songId: payment.songId,
        });
      }

      const payerWallet = payment.payer.wallet;
      if (!payerWallet) {
        throw new BlockchainError('Payer has no wallet', {
          payerId: payment.payerUserId,
        });
      }

      const env = getEnv();
      const { decryptPrivateKey } = await import('@pazzera/blockchain/wallet-signer');
      const privateKey = decryptPrivateKey(
        payment.payerUserId,
        payerWallet.encryptedPrivateKey,
      );

      const split = decideSplit({
        paymentId,
        amountUsdcBaseUnits: BigInt(payment.amountBaseUnits),
        recipients: splitRecipients,
      });

      const walletClient = getArcWalletClient(privateKey);
      const txHashes: string[] = [];
      const payoutIds: string[] = [];

      // Write debit entry ONCE for the whole payment (payer side)
      const debitEntry = await prisma.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          fromWalletId: payerWallet.id,
          fromAddress: payerWallet.address,
          fromUserId: payment.payerUserId,
          grossAmountBaseUnits: payment.amountBaseUnits,
          splitAmountBaseUnits: payment.amountBaseUnits,
          direction: 'debit',
          kind: 'stream_payment',
          status: 'pending',
          currency: 'USDC',
          memo: `Payment for stream ${payment.streamId}`,
        },
      });

      for (const t of split.transfers) {
        const txHash = await walletClient.sendTransaction({
          to: env.USDC_CONTRACT_ADDRESS as `0x${string}`,
          data: encodeTransfer(t.recipientAddress as `0x${string}`, t.amountBaseUnits),
        });
        const receipt = await waitForReceipt(txHash);

        // Find wallet for this recipient if internal
        let toWalletId: string | null = null;
        if (t.recipientUserId) {
          const w = await prisma.wallet.findUnique({
            where: { userId: t.recipientUserId },
            select: { id: true },
          });
          toWalletId = w?.id ?? null;
        }

        const payout = await prisma.payout.create({
          data: {
            paymentId: payment.id,
            recipientUserId: t.recipientUserId,
            recipientUsername: t.recipientUsername,
            recipientAddress: t.recipientAddress,
            recipientRole: t.recipientRole,
            splitPercentageBps:
              splitRecipients.find((r) => r.username === t.recipientUsername)?.bps ?? 0,
            amountUsdc: (Number(t.amountBaseUnits) / 10 ** env.USDC_DECIMALS).toString(),
            amountBaseUnits: t.amountBaseUnits.toString(),
            txHash: receipt.transactionHash,
            status: receipt.status === 'success' ? 'sent' : 'failed',
            confirmedAt: receipt.status === 'success' ? new Date() : null,
          },
        });

        // Write matching credit entry (recipient side)
        await prisma.ledgerEntry.create({
          data: {
            paymentId: payment.id,
            payoutId: payout.id,
            fromWalletId: payerWallet.id,
            fromAddress: payerWallet.address,
            fromUserId: payment.payerUserId,
            toWalletId,
            toAddress: t.recipientAddress,
            toUserId: t.recipientUserId,
            grossAmountBaseUnits: payment.amountBaseUnits,
            splitAmountBaseUnits: t.amountBaseUnits.toString(),
            direction: 'credit',
            kind: 'royalty_payout',
            status: receipt.status === 'success' ? 'settled' : 'failed',
            chainTxHash: receipt.transactionHash,
            chainBlockNumber: BigInt(receipt.blockNumber.toString()),
            chainConfirmedAt: new Date(),
            currency: 'USDC',
            memo: `Royalty payout for ${t.recipientUsername} (${t.recipientRole})`,
          },
        });

        // Update credit entry status — debit entry stays "settled" only after all payouts succeed
        txHashes.push(receipt.transactionHash);
        payoutIds.push(payout.id);
      }

      await prisma.ledgerEntry.update({
        where: { id: debitEntry.id },
        data: { status: 'settled' },
      });

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'distributed', distributedAt: new Date() },
      });

      // Bump analytics (Phase 7 will move this to a dedicated rollup worker)
      await prisma.songMetrics.upsert({
        where: { songId: payment.songId },
        create: {
          songId: payment.songId,
          streamCount: 1,
          totalRevenueUsdc: (Number(payment.amountBaseUnits) / 10 ** env.USDC_DECIMALS).toString(),
          totalRevenueBaseUnits: payment.amountBaseUnits,
          lastStreamAt: new Date(),
        },
        update: {
          streamCount: { increment: 1 },
          totalRevenueBaseUnits: { increment: BigInt(payment.amountBaseUnits) },
          totalRevenueUsdc: { increment: Number(payment.amountBaseUnits) / 10 ** env.USDC_DECIMALS },
          lastStreamAt: new Date(),
        },
      }).catch(() => undefined);

      await prisma.agentLog.create({
        data: {
          agent: 'split',
          paymentId: payment.id,
          decision: 'distributed',
          payloadJson: { payoutIds, txHashes, split } as unknown as object,
        },
      });

      // Notify realtime room
      const { getIO } = await import('@pazzera/realtime');
      const io = getIO();
      if (io) {
        io.to(`stream:${payment.streamId}`).emit('stream:payout_done', {
          streamId: payment.streamId,
          paymentId: payment.id,
          totalDistributed: (Number(split.totalBaseUnits) / 10 ** env.USDC_DECIMALS).toString(),
          recipients: split.transfers.map((t) => ({
            username: t.recipientUsername,
            amount: (Number(t.amountBaseUnits) / 10 ** env.USDC_DECIMALS).toString(),
          })),
        });
      }

      logger.info(
        { paymentId, payoutCount: payoutIds.length },
        'split:done',
      );
    },
    { connection: getQueueConnection(), concurrency: 8 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'split:failed');
  });

  return worker;
}