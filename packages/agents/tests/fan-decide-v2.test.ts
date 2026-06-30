import { describe, it, expect } from 'vitest';
import { decideFan, type FanInput } from '../src/fan/decide';

const baseInput: FanInput = {
  streamId: 'st1',
  songId: 's1',
  userId: 'u1',
  songDurationSeconds: 200,
  listenDurationSec: 60, // 30% — should comfortably cross 25% threshold
  mutedDurationSec: 0,
  hiddenDurationSec: 0,
  seekCount: 0,
  loopCount: 0,
  maxPlaybackRate: 1,
  deviceFingerprintSharedWithUsers: 0,
  ipSharedWithUsersLast24h: 0,
  userPriorChargesForSongLast24h: 0,
  userAccountAgeDays: 90,
  thresholdPct: 25,
};

describe('decideFan v2', () => {
  it('classifies a normal listen as valid and triggers payment', () => {
    const r = decideFan(baseInput);
    expect(r.classification).toBe('valid_stream');
    expect(r.shouldCharge).toBe(true);
    expect(r.paymentTriggerSec).toBe(50); // 25% of 200s
    expect(r.fraudScore).toBeLessThan(25);
  });

  it('rejects payment if listen did not reach threshold', () => {
    const r = decideFan({ ...baseInput, listenDurationSec: 30 });
    expect(r.classification).toBe('partial_stream');
    expect(r.shouldCharge).toBe(false);
  });

  it('flags hidden tab as suspicious and refuses to charge', () => {
    const r = decideFan({ ...baseInput, hiddenDurationSec: 50, listenDurationSec: 60 });
    expect(r.fraudScore).toBeGreaterThan(20);
    expect(['suspicious_stream', 'partial_stream', 'fraudulent_stream']).toContain(r.classification);
    expect(r.shouldCharge).toBe(false);
  });

  it('flags 2x playback combined with hidden tab as fraudulent', () => {
    const r = decideFan({ ...baseInput, maxPlaybackRate: 2, hiddenDurationSec: 80, listenDurationSec: 80, mutedDurationSec: 0 });
    expect(r.fraudScore).toBeGreaterThanOrEqual(60);
    expect(['suspicious_stream', 'fraudulent_stream']).toContain(r.classification);
  });

  it('captures reasons array always non-empty', () => {
    const r = decideFan(baseInput);
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('signals object is always defined', () => {
    const r = decideFan(baseInput);
    expect(r.signals).toBeDefined();
    expect(r.signals.thresholdSec).toBe(50);
    expect(r.signals.listenDurationSec).toBe(60);
  });
});