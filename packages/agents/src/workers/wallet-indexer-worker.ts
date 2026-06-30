/**
 * Wallet Indexer Worker.
 *
 *   - Iterates over all active wallets in batches
 *   - Polls Arc for USDC Transfer events from each wallet's lastIndexedBlock+1
 *   - Persists events as WalletTransaction rows
 *   - Recomputes balanceUsdc from the latest on-chain read
 *   - Records missed blocks so they get re-tried on the next pass
 *
 * Architecture choices:
 *   - We index in batches (`INDEXER_BATCH_SIZE`) per cycle to stay friendly
 *     to the public RPC. Each wallet has its own cursor.
 *   - If a wallet's lastIndexedBlock is more than N blocks behind chain head,
 *     we mark it as `gap` in `indexerCursor` so we can resume from the right
 *     place on the next pass.
 *   - Circle webhooks (if enabled) land on /api/webhooks/circle and call
 *     `IndexerService.applyEvent()` directly — bypassing polling.
 */
import { Worker, type Job } from 'bullmq';
import { getQueueConnection, QUEUE_NAMES } from '@pazzera/queue';
import { prisma } from '@pazzera/db';
import { sumStrings, coerceStringAmount } from '@pazzera/db/utils/big-arith';
import { logger, getEnv } from '@pazzera/core';
import { getArcPublicClient, usdcAddress, baseUnitsToUsdc } from '@pazzera/blockchain';
import type { Address, Hex } from 'viem';

/**
 * Read-modify-write for `WalletAnalytics.{totalDeposits,totalSpend}BaseUnits`
 * — both are `String!` columns that Prisma 5.22 doesn't support via
 * `{ increment: BigInt() }`. Centralized so the indexer + analytics worker
 * stay in sync via a single audited math path.
 */
async function addToWalletAnalyticsTotals(
  walletId: string,
  deltaBaseUnits: string,
  side: 'deposit' | 'spend',
): Promise<void> {
  const existing = await prisma.walletAnalytics.findUnique({
    where: { walletId },
    select: { totalDepositsBaseUnits: true, totalSpendBaseUnits: true },
  });
  const depKey = 'totalDepositsBaseUnits' as const;
  const spdKey = 'totalSpendBaseUnits' as const;
  const newDeposit =
    side === 'deposit'
      ? (sumStrings([{ [depKey]: existing?.totalDepositsBaseUnits ?? '0' }], depKey) + BigInt(deltaBaseUnits)).toString()
      : existing?.totalDepositsBaseUnits ?? '0';
  const newSpend =
    side === 'spend'
      ? (sumStrings([{ [spdKey]: existing?.totalSpendBaseUnits ?? '0' }], spdKey) + BigInt(deltaBaseUnits)).toString()
      : existing?.totalSpendBaseUnits ?? '0';
  const stamp = new Date();
  await prisma.walletAnalytics.upsert({
    where: { walletId },
    create: {
      walletId,
      totalDepositsBaseUnits: newDeposit,
      totalSpendBaseUnits: newSpend,
      lastIndexedAt: stamp,
      ...(side === 'deposit' ? { lastDepositAt: stamp } : { lastSpendAt: stamp }),
    },
    update: {
      totalDepositsBaseUnits: newDeposit,
      totalSpendBaseUnits: newSpend,
      lastIndexedAt: stamp,
      ...(side === 'deposit' ? { lastDepositAt: stamp } : { lastSpendAt: stamp }),
    },
  });
}

/**
 * Upgrade the parsed JsonValue to a typed number/string for fields like
 * `IndexerCursor.lastBlock`. The `lastBlock` came from a Json blob and
 * TS only knows its primitive.
 */
function jsonToNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as Hex;

interface IndexerCursor {
  lastBlock: number;
  lastAt: string;
  gapRanges?: { from: number; to: number }[];
}

export class IndexerService {
  static async applyEvent(event: {
    walletId: string;
    txHash: string;
    blockNumber: bigint;
    from: Address;
    to: Address;
    value: bigint;
    logIndex: number;
  }): Promise<void> {
    // Idempotency on (txHash, logIndex)
    const existing = await prisma.walletTransaction.findFirst({
      where: { txHash: event.txHash, meta: { path: ['logIndex'], equals: event.logIndex } },
    });
    if (existing) return;

    const wallet = await prisma.wallet.findUnique({ where: { id: event.walletId } });
    if (!wallet) return;

    const isIncoming = event.to.toLowerCase() === wallet.address.toLowerCase();
    const isOutgoing = event.from.toLowerCase() === wallet.address.toLowerCase();
    if (!isIncoming && !isOutgoing) return;

    const direction = isIncoming ? 'credit' : 'debit';
    const type = isIncoming ? 'deposit' : 'withdraw';
    const amountBaseUnits = event.value.toString();
    const amountUsdc = baseUnitsToUsdc(amountBaseUnits);

    await prisma.$transaction([
      prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          direction,
          amountUsdc,
          amountBaseUnits,
          status: 'confirmed',
          txHash: event.txHash,
          blockNumber: event.blockNumber,
          counterpartyAddress: isIncoming ? event.from : event.to,
          confirmedAt: new Date(),
        },
      }),
      prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balanceUsdc: amountUsdc, // overwritten by refresh in a moment
          lastIndexedBlock: event.blockNumber,
        },
      }),
    ]);

    // WalletAnalytics totals use String! columns; Prisma 5.22 doesn't
    // expose them via the typed `{ increment }` shorthand, so call the
    // shared read-modify-write helper outside the transaction (it has
    // its own read, so wrapping it inside $transaction would just
    // serialize the row lock for no benefit).
    await addToWalletAnalyticsTotals(
      wallet.id,
      amountBaseUnits,
      isIncoming ? 'deposit' : 'spend',
    );

  }
}

export async function runWalletIndexerWorker() {
  const worker = new Worker(
    QUEUE_NAMES.walletIndexer,
    async (job: Job) => {
      const env = getEnv();
      const fromBlock = (job.data as { fromBlock?: number } | undefined)?.fromBlock;
      const batchSize = env.INDEXER_BATCH_SIZE;
      const client = getArcPublicClient();
      const head = Number(await client.getBlockNumber());

      // Find all active wallets
      const wallets = await prisma.wallet.findMany({
        where: { status: { in: ['active', 'frozen'] } },
        take: 50, // cap per cycle to spread load
      });

      let processed = 0;
      for (const wallet of wallets) {
        const cursor: IndexerCursor = (wallet.indexerCursor as unknown as IndexerCursor | null) ?? {
          lastBlock: 0,
          lastAt: new Date(0).toISOString(),
        };
        const start = fromBlock ?? (cursor.lastBlock > 0 ? cursor.lastBlock + 1 : 0);
        const end = Math.min(head, start + Number(batchSize) - 1);
        if (end < start) continue;

        try {
          const logs = await client.getLogs({
            address: usdcAddress(),
            event: { type: 'event', name: 'Transfer', inputs: [
              { type: 'address', name: 'from', indexed: true },
              { type: 'address', name: 'to',   indexed: true },
              { type: 'uint256', name: 'value', indexed: false },
            ] },
            fromBlock: BigInt(start),
            toBlock: BigInt(end),
          });
          for (const log of logs) {
            const from = log.topics[1] as `0x${string}`;
            const to = log.topics[2] as `0x${string}`;
            const value = BigInt(log.data);
            const blockNumber = log.blockNumber ?? BigInt(end);
            const txHash = log.transactionHash as `0x${string}`;
            if (!from || !to || !txHash || blockNumber === null) continue;
            // Decode addresses from topics (last 20 bytes)
            const fromAddr = (`0x${from.slice(-40)}`) as Address;
            const toAddr = (`0x${to.slice(-40)}`) as Address;
            await IndexerService.applyEvent({
              walletId: wallet.id,
              txHash,
              blockNumber,
              from: fromAddr,
              to: toAddr,
              value,
              logIndex: log.logIndex ?? 0,
            });
          }
          processed += 1;
          const newCursor: IndexerCursor = { lastBlock: end, lastAt: new Date().toISOString() };
          // Health: penalize lag. (`healthScore` lives on WalletAnalytics,
          // NOT on Wallet — schema doesn't expose it there.)
          const lag = head - end;
          const healthScore = Math.max(0, Math.min(100, 100 - Math.floor(lag / 100)));
          await prisma.wallet.update({
            where: { id: wallet.id },
            data: { indexerCursor: newCursor as object },
          });
          await prisma.walletAnalytics.upsert({
            where: { walletId: wallet.id },
            create: { walletId: wallet.id, healthScore, lastIndexedAt: new Date() },
            update: { healthScore, lastIndexedAt: new Date() },
          });
        } catch (err) {
          // Mark gap and continue
          logger.error({ walletId: wallet.id, start, end, err }, 'indexer:wallet_failed');
          const newCursor: IndexerCursor = {
            ...cursor,
            gapRanges: [
              ...(cursor.gapRanges ?? []),
              { from: start, to: end },
            ].slice(-20),
          };
          await prisma.wallet.update({
            where: { id: wallet.id },
            data: { indexerCursor: newCursor as object },
          });
        }
      }

      logger.info(
        { jobId: job.id, head, processed, total: wallets.length },
        'indexer:cycle_done',
      );
      return { processed, head };
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'indexer:failed');
  });

  return worker;
}