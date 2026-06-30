/**
 * AgentHealthTracker — small helper for worker code.
 *
 * Every agent worker calls this at job start (inProgress), on success
 * (success), on failure (failure), on retry (retry). The tracker flushes
 * to AgentHealthMetrics every time the bucket changes (default: 1 min).
 */
import type { PrismaClient } from '@prisma/client';

interface BucketState {
  bucketStart: Date;
  jobsProcessed: number;
  jobsFailed: number;
  jobsRetried: number;
  latencies: number[];
  activeJobs: number;
  lastExecutionAt: Date;
}

export class AgentHealthTracker {
  private buckets = new Map<string, BucketState>();

  constructor(
    private prisma: PrismaClient,
    private agent: string,
    private scope: 'minute' | 'hour' | 'day' = 'minute',
    private bucketMs = 60_000,
  ) {}

  private bucketKey(now: Date): { bucketStart: Date; bucketEnd: Date } {
    const bucketStart = new Date(Math.floor(now.getTime() / this.bucketMs) * this.bucketMs);
    const bucketEnd = new Date(bucketStart.getTime() + this.bucketMs);
    return { bucketStart, bucketEnd };
  }

  private async ensure(key: string): Promise<BucketState> {
    let state = this.buckets.get(key);
    if (!state) {
      const { bucketStart, bucketEnd } = this.bucketKey(new Date());
      state = {
        bucketStart,
        jobsProcessed: 0,
        jobsFailed: 0,
        jobsRetried: 0,
        latencies: [],
        activeJobs: 0,
        lastExecutionAt: new Date(0),
      };
      this.buckets.set(key, state);
      await this.prisma.agentHealthMetrics.create({
        data: {
          agent: this.agent,
          scope: this.scope,
          bucketStart,
          bucketEnd,
        },
      }).catch(() => undefined);
    }
    return state;
  }

  async inProgress(): Promise<void> {
    const key = new Date().toISOString();
    const s = await this.ensure(key);
    s.activeJobs += 1;
    s.lastExecutionAt = new Date();
  }

  async success(latencyMs: number, queueDepth = 0): Promise<void> {
    const key = new Date().toISOString();
    const s = await this.ensure(key);
    s.jobsProcessed += 1;
    s.activeJobs = Math.max(0, s.activeJobs - 1);
    s.latencies.push(latencyMs);
    if (s.latencies.length > 200) s.latencies.shift();
    await this.flush(key, s, queueDepth);
  }

  async failure(latencyMs: number, queueDepth = 0): Promise<void> {
    const key = new Date().toISOString();
    const s = await this.ensure(key);
    s.jobsFailed += 1;
    s.activeJobs = Math.max(0, s.activeJobs - 1);
    s.lastExecutionAt = new Date();
    if (latencyMs > 0) s.latencies.push(latencyMs);
    await this.flush(key, s, queueDepth);
  }

  async retry(queueDepth = 0): Promise<void> {
    const key = new Date().toISOString();
    const s = await this.ensure(key);
    s.jobsRetried += 1;
    await this.flush(key, s, queueDepth);
  }

  private computePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
    return sorted[idx]!;
  }

  private async flush(key: string, s: BucketState, queueDepth: number): Promise<void> {
    const { bucketStart, bucketEnd } = this.bucketKey(s.lastExecutionAt);
    const total = s.jobsProcessed + s.jobsFailed;
    const successRate = total === 0 ? 1 : s.jobsProcessed / total;
    const status =
      successRate >= 0.99 ? 'healthy'
        : successRate >= 0.9 ? 'degraded'
          : successRate >= 0.5 ? 'unhealthy'
            : 'unknown';
    await this.prisma.agentHealthMetrics.upsert({
      where: {
        agent_scope_bucketStart: {
          agent: this.agent,
          scope: this.scope,
          bucketStart,
        },
      },
      create: {
        agent: this.agent,
        scope: this.scope,
        bucketStart,
        bucketEnd,
        jobsProcessed: s.jobsProcessed,
        jobsFailed: s.jobsFailed,
        jobsRetried: s.jobsRetried,
        p50LatencyMs: this.computePercentile(s.latencies, 0.5),
        p95LatencyMs: this.computePercentile(s.latencies, 0.95),
        p99LatencyMs: this.computePercentile(s.latencies, 0.99),
        queueDepth,
        activeJobs: s.activeJobs,
        lastExecutionAt: s.lastExecutionAt,
        status,
        successRate,
      },
      update: {
        jobsProcessed: s.jobsProcessed,
        jobsFailed: s.jobsFailed,
        jobsRetried: s.jobsRetried,
        p50LatencyMs: this.computePercentile(s.latencies, 0.5),
        p95LatencyMs: this.computePercentile(s.latencies, 0.95),
        p99LatencyMs: this.computePercentile(s.latencies, 0.99),
        queueDepth,
        activeJobs: s.activeJobs,
        lastExecutionAt: s.lastExecutionAt,
        status,
        successRate,
      },
    });
    // Trim in-memory buckets older than current
    if (this.buckets.size > 16) {
      const keys = [...this.buckets.keys()];
      const oldest = keys[0]!;
      this.buckets.delete(oldest);
    }
    void key;
  }
}