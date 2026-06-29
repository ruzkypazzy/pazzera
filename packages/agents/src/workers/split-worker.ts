/**
 * Split worker — picks up settled Payment rows, resolves recipient wallets,
 * submits on-chain USDC transfers per recipient, writes Payout rows.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { logger, getEnv, BlockchainError } from '@pazzera/core';
import {
  getArcWalletClient,
  waitForReceipt,
} from '@pazzera/blockchain';
import { encodeTransfer, usdcToBaseUnits } from '@pazzera/blockchain/usdc';
import { decideSplit } from '../split/decide';

export async function runSplitWorker() {
  const worker = new Worker(
    QUEUE_NAMES.agentSplit,
    async (job: Job) => {
      const { paymentId } = job.data as { paymentId: string };
      logger.info({ paymentId, jobId: job.id }, 'split:start');

      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          song: {
            include: {
              recipients: { include: { user: { include: { wallet: true } } } },
            },
          },
          payer: { include: { wallet: true } },
        },
      });
      if (!payment) return;
      if (payment.status !== 'settled') {
        logger.info({ paymentId, status: payment.status }, 'split:not_settled');
        return;
      }
      if (!payment.facilitatorTransferId) {
        logger.warn({ paymentId }, 'split:no_transfer_id');
        return;
      }

      const recipients = payment.song.recipients.map((r) => {
        if (!r.user.wallet) {
          throw new BlockchainError(
            `Recipient ${r.username} has no wallet`,
            { recipientId: r.id },
          );
        }
        return {
          username: r.username,
          walletAddress: r.user.wallet.address as `0x${string}`,
          role: r.role,
          bps: r.percentageBps,
        };
      });

      if (recipients.length === 0) {
        throw new BlockchainError('Song has no recipients', { songId: payment.songId });
      }

      const env = getEnv();
      // Payer wallet signs and sends USDC transfers to each recipient.
      // In a more advanced setup this would call a SplitProcessor contract;
      // for now we batch sequential transfers (gas-cost is on testnet only).
      const payerWallet = payment.payer.wallet;
      if (!payerWallet) {
        throw new BlockchainError('Payer has no wallet', { payerId: payment.payerUserId });
      }

      // Decrypt payer private key (kept in memory only for the duration of this job)
      const { decryptPrivateKey } = await import('@pazzera/blockchain/wallet-signer');
      const privateKey = decryptPrivateKey(payment.payerUserId, payerWallet.encryptedPrivateKey);

      const split = decideSplit({
        paymentId,
        amountUsdcBaseUnits: BigInt(payment.amountBaseUnits),
        recipients,
      });

      const walletClient = getArcWalletClient(privateKey);
      const txHashes: string[] = [];
      const payoutIds: string[] = [];

      for (const t of split.transfers) {
        const txHash = await walletClient.sendTransaction({
          to: env.USDC_CONTRACT_ADDRESS as `0x${string}`,
          data: encodeTransfer(t.recipientAddress, t.amountBaseUnits),
        });
        const receipt = await waitForReceipt(txHash);
        txHashes.push(receipt.transactionHash);
        const payout = await prisma.payout.create({
          data: {
            paymentId: payment.id,
            recipientUsername: t.recipientUsername,
            recipientAddress: t.recipientAddress,
            amountBaseUnits: t.amountBaseUnits.toString(),
            amountUsdc: (Number(t.amountBaseUnits) / 10 ** env.USDC_DECIMALS).toString(),
            txHash: receipt.transactionHash,
            status: receipt.status === 'success' ? 'sent' : 'failed',
          },
        });
        payoutIds.push(payout.id);
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'distributed', distributedAt: new Date() },
      });

      await prisma.agentLog.create({
        data: {
          agent: 'split',
          paymentId: payment.id,
          decision: 'distributed',
          payloadJson: JSON.stringify({ payoutIds, txHashes }),
        },
      });

      // Notify the realtime room
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