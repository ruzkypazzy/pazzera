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
  agentDiscovery: 'agent:discovery',
  agentFraud: 'agent:fraud_sentinel',
  walletReconcile: 'wallet:reconcile',
  paymentSettle: 'payment:settle',
  streamMonitor: 'stream:monitor',
  walletIndexer: 'wallet:indexer',
  walletProvision: 'wallet:provision',
  authCleanup: 'auth:cleanup',
  maintenance: 'maintenance',
  analyticsRollup: 'analytics:rollup',
  uploadProcessAudio: 'upload:process-audio',
  uploadProcessCover: 'upload:process-cover',
  uploadGenerateWaveform: 'upload:generate-waveform',
  uploadGeneratePreview: 'upload:generate-preview',
  uploadCurator: 'upload:curator',
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

export interface DiscoveryJobPayload {
  /** Trigger type */
  type: 'rebuild_for_user' | 'rebuild_global' | 'on_stream_complete' | 'on_song_publish';
  userId?: string;
  songId?: string;
}

export interface WalletProvisionJobPayload {
  userId: string;
  /** Retry count — if this fails repeatedly we mark the wallet as `recovery_requested`. */
  attempt: number;
}

export interface AuthCleanupJobPayload {
  task: 'expire_otps' | 'expire_sessions' | 'gc_auth_events';
}

export interface UploadJobPayload {
  uploadId: string;
  songId: string;
  /** R2 key of the uploaded artifact (or local path during dev). */
  sourceKey: string;
  /** Re-encode steps that remain to be performed. */
  steps: Array<'metadata' | 'waveform' | 'preview' | 'cover' | 'nsfw' | 'curator'>;
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

export interface FraudJobPayload {
  detector: 'stream_farm' | 'payout_abuse' | 'sybil' | 'circular_payments' | 'all';
}

export interface AnalyticsRollupJobPayload {
  window: '5min' | 'hour' | 'day';
  bucketStart?: string;
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

export function getQueue(name: QueueName): Queue {
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
  discovery: (payload: DiscoveryJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.agentDiscovery).add('discovery.rebuild', payload, opts),
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
  walletProvision: (payload: WalletProvisionJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.walletProvision).add('wallet.provision', payload, opts),
  authCleanup: (payload: AuthCleanupJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.authCleanup).add(payload.task, payload, opts),
  uploadProcessAudio: (payload: UploadJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.uploadProcessAudio).add('upload.audio', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { count: 500, age: 24 * 3600 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
      ...(opts ?? {}),
    }),
  uploadProcessCover: (payload: UploadJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.uploadProcessCover).add('upload.cover', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500, age: 24 * 3600 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
      ...(opts ?? {}),
    }),
  uploadGenerateWaveform: (payload: UploadJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.uploadGenerateWaveform).add('upload.waveform', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500, age: 24 * 3600 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
      ...(opts ?? {}),
    }),
  uploadGeneratePreview: (payload: UploadJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.uploadGeneratePreview).add('upload.preview', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500, age: 24 * 3600 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
      ...(opts ?? {}),
    }),
  uploadCurator: (payload: UploadJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.uploadCurator).add('upload.curator', payload, {
      attempts: 1,
      removeOnComplete: { count: 500, age: 24 * 3600 },
      ...(opts ?? {}),
    }),
  maintenance: (payload: MaintenanceJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.maintenance).add(payload.task, payload, opts),
  analyticsRollup: (payload: MaintenanceJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.analyticsRollup).add(payload.task, payload, opts),
  fraud: (payload: FraudJobPayload, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.agentFraud).add('fraud.scan', payload, {
      attempts: 1,
      removeOnComplete: { count: 50, age: 24 * 3600 },
      ...opts,
    }),
  walletReconcile: (payload: MaintenanceJobPayload = { task: 'reconcile' }, opts?: JobsOptions) =>
    getQueue(QUEUE_NAMES.walletReconcile).add('wallet.reconcile', payload, {
      attempts: 1,
      removeOnComplete: { count: 50, age: 24 * 3600 },
      ...opts,
    }),
};

export function getAllQueues(): Queue[] {
  return Object.values(QUEUE_NAMES).map(getQueue);
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(getAllQueues().map((q) => q.close().catch(() => undefined)));
  queueCache.clear();
}