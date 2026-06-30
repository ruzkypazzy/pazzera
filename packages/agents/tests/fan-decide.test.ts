import { describe, it, expect } from 'vitest';
import { decideFan, type FanStreamContext } from '../src/fan/decide';

const baseCtx: FanStreamContext = {
  streamId: 'stream-1',
  userId: 'user-1',
  songId: 'song-1',
  durationSeconds: 200,
  startedAt: new Date(Date.now() - 60_000),
  endedAt: null,
  charged: false,
  flaggedAbuse: false,
  ticks: Array.from({ length: 12 }, (_, i) => ({
    monotonicMs: Date.now() - (12 - i) * 5000,
    positionSec: i * 4,
    wasSeek: false,
    wasPause: false,
    wasMuted: false,
    wasHidden: false,
    wasLooped: false,
  })),
  largeSeekCount: 0,
  activeMs: 60_000,
  hasRecentConcurrentStream: false,
  userHistory: {
    streamsLast1h: 1,
    streamsLast24h: 5,
    uniqueDevicesLast7d: 1,
    uniqueIpsLast7d: 1,
    priorFraudScoreAvg: 5,
    accountAgeDays: 30,
  },
  ipAddress: '203.0.113.10',
  deviceFingerprintId: 'fp-1',
  deviceFingerprintUserCount: 1,
};

describe('decideFan', () => {
  it('approves a clean stream', () => {
    const result = decideFan({ streamId: 's' }, baseCtx);
    expect(result.shouldCharge).toBe(true);
    expect(result.fraudScore).toBeLessThan(50);
    expect(result.manualReview).toBe(false);
  });

  it('skips already-charged streams', () => {
    const result = decideFan({ streamId: 's' }, { ...baseCtx, charged: true });
    expect(result.shouldCharge).toBe(false);
    expect(result.reason).toBe('already_charged');
  });

  it('skips below-minimum active time', () => {
    const result = decideFan({ streamId: 's' }, { ...baseCtx, activeMs: 5000 });
    expect(result.shouldCharge).toBe(false);
    expect(result.reason).toBe('below_min_active_time');
  });

  it('flags for manual review when muted majority + farm pattern', () => {
    const mutedTicks = baseCtx.ticks.map((t) => ({
      ...t,
      wasMuted: true,
    }));
    const result = decideFan(
      { streamId: 's' },
      {
        ...baseCtx,
        ticks: mutedTicks,
        userHistory: { ...baseCtx.userHistory, streamsLast1h: 12 },
      },
    );
    expect(result.fraudScore).toBeGreaterThanOrEqual(50);
    expect(result.manualReview).toBe(true);
  });

  it('auto-rejects with high fraud score (extreme farm + device repeat + hidden)', () => {
    const hiddenTicks = baseCtx.ticks.map((t) => ({ ...t, wasHidden: true, wasMuted: true }));
    const result = decideFan(
      { streamId: 's' },
      {
        ...baseCtx,
        ticks: hiddenTicks,
        userHistory: { ...baseCtx.userHistory, streamsLast1h: 30, accountAgeDays: 0 },
        deviceFingerprintUserCount: 6,
      },
    );
    expect(result.fraudScore).toBeGreaterThanOrEqual(80);
    expect(result.shouldCharge).toBe(false);
    expect(result.reason).toBe('auto_reject_fraud');
  });

  it('detects loop_play as a contributing signal', () => {
    const loopedTicks = baseCtx.ticks.map((t, i) => ({ ...t, wasLooped: i > 8 }));
    const result = decideFan({ streamId: 's' }, { ...baseCtx, ticks: loopedTicks });
    expect(result.signals.some((s) => s.type === 'loop_play')).toBe(true);
  });

  it('rejects concurrent streams', () => {
    const result = decideFan(
      { streamId: 's' },
      { ...baseCtx, hasRecentConcurrentStream: true },
    );
    expect(result.signals.some((s) => s.type === 'concurrent_stream')).toBe(true);
  });
});