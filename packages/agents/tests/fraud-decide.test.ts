/**
 * Fraud Sentinel decision tests — pure function, no I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  detectStreamFarm,
  detectCircularPayments,
  detectSybil,
  detectPayoutAbuse,
  severityFor,
  autoActionFor,
} from '../src/fraud/decide';

describe('severityFor', () => {
  it('maps scores to severities', () => {
    expect(severityFor(10)).toBe('low');
    expect(severityFor(40)).toBe('medium');
    expect(severityFor(75)).toBe('high');
    expect(severityFor(95)).toBe('critical');
  });
});

describe('autoActionFor', () => {
  it('does not act on low/medium severity', () => {
    expect(autoActionFor('low', 'wallet')).toBeUndefined();
    expect(autoActionFor('medium', 'user')).toBeUndefined();
  });
  it('freezes payouts on high severity for wallet/user', () => {
    expect(autoActionFor('high', 'wallet')).toBe('payouts_paused');
    expect(autoActionFor('high', 'user')).toBe('payouts_paused');
  });
  it('locks accounts on critical severity', () => {
    expect(autoActionFor('critical', 'wallet')).toBe('account_locked');
    expect(autoActionFor('critical', 'user')).toBe('account_locked');
    expect(autoActionFor('critical', 'payment_cluster')).toBe('payouts_paused');
    expect(autoActionFor('critical', 'song')).toBe('payouts_paused');
  });
});

describe('detectStreamFarm', () => {
  it('returns low severity for normal listening', () => {
    const r = detectStreamFarm({
      walletAddress: '0x1',
      artistId: 'a1',
      streamsLast7d: 3,
      uniqueListenersLast7d: 3,
      avgListenDurationSec: 220,
      sameSongRepeatCount: 0,
    });
    expect(r.score).toBeLessThan(50);
    expect(['low', 'medium']).toContain(r.severity);
  });

  it('returns critical severity for extreme stream farming', () => {
    const r = detectStreamFarm({
      walletAddress: '0x1',
      artistId: 'a1',
      streamsLast7d: 200,
      uniqueListenersLast7d: 1,
      avgListenDurationSec: 10,
      sameSongRepeatCount: 40,
    });
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(['high', 'critical']).toContain(r.severity);
    expect(r.autoAction).toBeDefined();
  });
});

describe('detectCircularPayments', () => {
  it('returns low severity when no cycles', () => {
    const r = detectCircularPayments({
      payerUserId: 'a1',
      payerArtistId: 'a1',
      payerStreamsLast7d: 0,
      payerListenersLast7d: 0,
      cycles: [],
    });
    expect(r.score).toBe(0);
    expect(r.severity).toBe('low');
  });

  it('flags strong circular patterns as high or critical', () => {
    const r = detectCircularPayments({
      payerUserId: 'a1',
      payerArtistId: 'a1',
      payerStreamsLast7d: 50,
      payerListenersLast7d: 0,
      cycles: [
        { listenerUserId: 'l1', streamsToPayer: 25, paymentsFromPayer: 25 },
        { listenerUserId: 'l2', streamsToPayer: 22, paymentsFromPayer: 20 },
        { listenerUserId: 'l3', streamsToPayer: 18, paymentsFromPayer: 19 },
      ],
    });
    expect(['high', 'critical']).toContain(r.severity);
  });
});

describe('detectSybil', () => {
  it('returns low severity for small/unrelated clusters', () => {
    const r = detectSybil({
      userIds: ['u1', 'u2'],
      ipCluster: '1.2.3.4',
      createdAtWindowHours: 168,
      identicalStreamTargetSongId: null,
      identicalTimingStdDevSec: 600,
    });
    expect(r.score).toBeLessThan(50);
  });

  it('flags clear sybil pattern with auto-lock', () => {
    const r = detectSybil({
      userIds: Array.from({ length: 30 }, (_, i) => `u${i}`),
      ipCluster: '4.4.4.4',
      createdAtWindowHours: 8,
      identicalStreamTargetSongId: 'song-1',
      identicalTimingStdDevSec: 0.3,
    });
    expect(['high', 'critical']).toContain(r.severity);
    expect(r.autoAction).toBeDefined();
    expect(r.reasons.length).toBeGreaterThanOrEqual(4);
  });
});

describe('detectPayoutAbuse', () => {
  it('does not flag a low-activity wallet', () => {
    const r = detectPayoutAbuse({
      walletId: 'w1',
      payoutsLast24h: 1,
      payoutsLast7d: 3,
      totalPayoutsLast7dUsdc: '0.10',
      walletBalanceUsdc: '5.00',
      depositsLast7d: 10,
      unusualRecipientCount: 1,
    });
    expect(r.score).toBeLessThan(25);
  });

  it('flags draining + fanout as critical', () => {
    const r = detectPayoutAbuse({
      walletId: 'w1',
      payoutsLast24h: 12,
      payoutsLast7d: 60,
      totalPayoutsLast7dUsdc: '5.0',
      walletBalanceUsdc: '0.001',
      depositsLast7d: 1,
      unusualRecipientCount: 25,
    });
    expect(['high', 'critical']).toContain(r.severity);
  });
});