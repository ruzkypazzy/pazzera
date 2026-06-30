/**
 * Decision recorder — every agent's worker calls this after the pure
 * decision function runs. Persists into AgentDecisionLog atomically with
 * the model's effect.
 *
 * Deterministic + idempotent: a unique constraint on
 *   (agent, inputHash)
 * means re-running an agent over the same input produces no duplicate
 * row (perfect for safe retries).
 */
import type { PrismaClient } from '@prisma/client';
import { hashInput } from './decision-hash';

export interface RecordDecisionInput {
  prisma: PrismaClient;
  agent: 'curator' | 'fan' | 'split' | 'discovery' | 'fraud_sentinel';
  subject: { type: string; id: string };
  input: unknown;
  decision: string;
  confidence: number;
  reasons: string[];
  categoryScores?: unknown;
  rawInputs?: unknown;
  latencyMs?: number;
  retries?: number;
  warnings?: string[];
  crossLinks?: {
    songId?: string;
    streamId?: string;
    paymentId?: string;
    userId?: string;
  };
  version?: string;
}

export async function recordDecision(p: RecordDecisionInput): Promise<string> {
  const inputHash = hashInput(p.agent, p.subject, p.input);
  const row = await p.prisma.agentDecisionLog.upsert({
    where: { agent_inputHash: { agent: p.agent, inputHash } },
    create: {
      agent: p.agent,
      subjectType: p.subject.type,
      subjectId: p.subject.id,
      decision: p.decision,
      confidence: Math.max(0, Math.min(100, Math.round(p.confidence))),
      reasons: p.reasons,
      categoryScores: p.categoryScores ?? undefined,
      inputs: p.rawInputs ?? undefined,
      latencyMs: p.latencyMs,
      retries: p.retries ?? 0,
      warnings: p.warnings ?? [],
      inputHash,
      songId: p.crossLinks?.songId,
      streamId: p.crossLinks?.streamId,
      paymentId: p.crossLinks?.paymentId,
      userId: p.crossLinks?.userId,
      version: p.version ?? 'v3',
    },
    update: {
      // If we re-ran, refresh the latest decision but keep the original id.
      decision: p.decision,
      confidence: Math.max(0, Math.min(100, Math.round(p.confidence))),
      reasons: p.reasons,
      categoryScores: p.categoryScores ?? undefined,
      latencyMs: p.latencyMs,
      retries: { increment: 1 },
    },
  });
  return row.id;
}