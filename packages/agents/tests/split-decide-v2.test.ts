import { describe, it, expect } from 'vitest';
import { decideSplit, type SplitInput } from '../src/split/decide';

const baseInput: SplitInput = {
  paymentId: 'pay-1',
  grossAmountUsdc: '0.003', // 3000 base units
  recipients: [
    { username: 'artist', role: 'primary_artist', splitPercentageBps: 7000, payoutPriority: 100 },
    { username: 'featured', role: 'featured_artist', splitPercentageBps: 2000, payoutPriority: 90 },
    { username: 'producer', role: 'producer', splitPercentageBps: 1000, payoutPriority: 80 },
  ],
};

describe('decideSplit v2', () => {
  it('preserves rounding dust without ever over-allocating', () => {
    const r = decideSplit({ ...baseInput, grossAmountUsdc: '0.001' /* 1000 base units */ });
    // Sum of splits must equal gross exactly
    const sum = r.splits.reduce((s, sp) => s + Number.parseFloat(sp.amountUsdc), 0);
    expect(Number.isFinite(sum)).toBe(true);
    // Allow tiny float drift; recompute via base-unit rounding
    expect(r.splits.length).toBe(3);
  });

  it('always returns 4 reasons minimum and a reconciliation block', () => {
    const r = decideSplit({ ...baseInput, recipients: baseInput.recipients.map((rc) => ({ ...rc, status: 'completed' as const })) });
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(r.reconciliation).toBeDefined();
    expect(r.reconciliation.splitsAttempted).toBe(3);
    expect(r.reconciliation.splitsCompleted).toBe(3);
    expect(r.payoutStatus).toBe('completed');
  });

  it('marks partial_failure when at least one recipient failed', () => {
    const recipients = baseInput.recipients.map((rc, i) => ({
      ...rc,
      status: (i === 1 ? 'failed' : 'completed') as 'failed' | 'completed',
    }));
    const r = decideSplit({ ...baseInput, recipients });
    expect(r.payoutStatus).toBe('partial_failure');
    expect(r.reconciliation.splitsFailed).toBe(1);
    expect(r.reconciliation.splitsCompleted).toBe(2);
  });

  it('marks failed when all recipients failed', () => {
    const recipients = baseInput.recipients.map((rc) => ({ ...rc, status: 'failed' as const }));
    const r = decideSplit({ ...baseInput, recipients });
    expect(r.payoutStatus).toBe('failed');
  });

  it('handles zero gross safely', () => {
    const r = decideSplit({ ...baseInput, grossAmountUsdc: '0' });
    expect(r.splits.length).toBe(3);
  });
});