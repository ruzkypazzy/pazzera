/**
 * Queue topology.
 *
 * Each queue name maps to a typed payload. Workers live in
 * `packages/agents/src/workers/*` and the web app's `server/workers.ts`.
 */
import { Queue, type JobsOptions } from 'bullmq';
import { getQueueConnection } from './connection';

export const QUEUE_NAMES = {
  agentCurator: 'agent:curator',
  agentFan: 'agent:fan',
  agentSplit: 'agent:split',
  paymentSettle: 'payment:settle',
  streamMonitor: 'stream:monitor',
  walletIndexer: 'wallet:indexer',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Job payload schemas ──────────────────────────────────────────────

export interface CuratorJobPayload {
  songId: string;
}

export interface FanJobPayload {
  streamId: string;
}

export interface SplitJobPayload {
  paymentId: string;
}

export interface PaymentSettleJobPayload {
  streamId: string;
  /** Already-signed EIP-712 authorization. */
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
    v: number;
    r: string;
    s: string;
  };
}

export interface StreamMonitorJobPayload {
  streamId: string;
}

export interface WalletIndexerJobPayload {
  fromBlock: number;
  toBlock?: number;
}

export interface MaintenanceJobPayload {
  task: string;
}

// ─── Default job options ─────────────────────────────────────────────

const DEFAULT_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { count: 1000, age: 24 * 3600 },
  removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
};

const HIGH_PRIORITY: JobsOptions = {
  ...DEFAULT_OPTS,
  attempts: 5,
  priority: 1,
};

const LOW_PRIORITY: JobsOptions = {
  ...DEFAULT_OPTS,
  attempts: 1,
};

// ─── Queue factories ──────────────────────────────────────────────────

const queueCache = new Map<string, Queue>();

function getQueue(name: QueueName): Queue {
  const cached = queueCache.get(name);
  if (cached) return cached;
  const q = new Queue(name, {
    connection: getQueueConnection(),
    defaultJobOptions: DEFAULT_OPTS,
  });
  queueCache.set(name, q);
  return q;
}

// ─── Enqueue helpers ─────────────────────────────────────────────────

export const enqueue = {
  curator: (payload: CuratorJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.agentCurator).add('curator.review', payload, opts),
  fan: (payload: FanJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.agentFan).add('fan.check', payload, {
      ...HIGH_PRIORITY,
      ...opts,
    }),
  split: (payload: SplitJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.agentSplit).add('split.distribute', payload, opts),
  paymentSettle: (payload: PaymentSettleJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.paymentSettle).add('payment.settle', payload, {
      ...HIGH_PRIORITY,
      ...opts,
    }),
  streamMonitor: (payload: StreamMonitorJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.streamMonitor).add('stream.monitor', payload, {
      ...LOW_PRIORITY,
      ...opts,
    }),
  walletIndexer: (payload: WalletIndexerJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.walletIndexer).add('wallet.index', payload, opts),
  maintenance: (payload: MaintenanceJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.maintenance).add(payload.task, payload, opts),
};

export function getAllQueues(): Queue[] {
  return Object.values(QUEUE_NAMES).map(getQueue);
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(getAllQueues().map((q) => q.close().catch(() => undefined)));
  queueCache.clear();
}