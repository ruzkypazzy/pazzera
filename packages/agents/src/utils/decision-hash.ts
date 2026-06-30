/**
 * Deterministic input hashing for AgentDecisionLog.
 *
 * Stable enough that the same canonical input produces the same hash
 * across runs (object key ordering normalized). Used together with
 *   AgentDecisionLog.agent + AgentDecisionLog.inputHash
 * to dedupe identical decisions; combined with input capture, lets us
 * replay decisions without storing huge blobs in their primary form.
 */
import { createHash } from 'node:crypto';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stable canonical JSON (sorted keys at every depth). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

export function hashInput(agent: string, subject: { type: string; id: string }, input: unknown): string {
  const canon = canonicalJson({ agent, subject, input });
  return createHash('sha256').update(canon).digest('hex');
}
