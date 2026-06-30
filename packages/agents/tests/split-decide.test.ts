import { describe, it, expect } from 'vitest';
import { decideSplit } from '../src/split/decide';

const amount = 100_000n; // 0.1 USDC in base units

describe('decideSplit', () => {
  it('throws on empty recipient list', () => {
    expect(() => decideSplit({ paymentId: 'p', amountUsdcBaseUnits: amount, recipients: [] })).toThrow();
  });

  it('throws when bps do not sum to 10000', () => {
    expect(() =>
      decideSplit({
        paymentId: 'p',
        amountUsdcBaseUnits: amount,
        recipients: [
          { username: 'a', walletAddress: '0xaaa', externalAddress: null, recipientUserId: 'u1', role: 'artist', bps: 5000, payoutPriority: 100 },
          { username: 'b', walletAddress: '0xbbb', externalAddress: null, recipientUserId: 'u2', role: 'producer', bps: 4000, payoutPriority: 100 },
        ],
      }),
    ).toThrow(/10000/);
  });

  it('distributes the exact gross amount (no value lost)', () => {
    const out = decideSplit({
      paymentId: 'p',
      amountUsdcBaseUnits: amount,
      recipients: [
        { username: 'artist',    walletAddress: '0xa', externalAddress: null, recipientUserId: 'u1', role: 'primary_artist',    bps: 7000, payoutPriority: 100 },
        { username: 'featured',  walletAddress: '0xb', externalAddress: null, recipientUserId: 'u2', role: 'featured_artist',   bps: 2000, payoutPriority: 110 },
        { username: 'producer',  walletAddress: '0xc', externalAddress: null, recipientUserId: 'u3', role: 'producer',          bps: 1000, payoutPriority: 120 },
      ],
    });
    const total = out.transfers.reduce((s, t) => s + t.amountBaseUnits, 0n);
    expect(total).toBe(amount);
  });

  it('handles the 5-way external + internal split from the seed', () => {
    const out = decideSplit({
      paymentId: 'p',
      amountUsdcBaseUnits: amount,
      recipients: [
        { username: 'ada',         walletAddress: '0xada',   externalAddress: null,           recipientUserId: 'u1', role: 'primary_artist',  bps: 5000, payoutPriority: 100 },
        { username: 'tunde',       walletAddress: '0xtunde', externalAddress: null,           recipientUserId: 'u2', role: 'featured_artist', bps: 2000, payoutPriority: 110 },
        { username: 'claire',      walletAddress: '0xclaire',externalAddress: null,           recipientUserId: 'u3', role: 'featured_artist', bps: 1000, payoutPriority: 120 },
        { username: 'beatsbyneo',  walletAddress: null,       externalAddress: '0xbeatsbyneo',recipientUserId: null, role: 'producer',        bps: 1500, payoutPriority: 130 },
        { username: 'sampleclear', walletAddress: null,       externalAddress: '0xsampleclear',recipientUserId:null, role: 'songwriter',      bps:  500, payoutPriority: 140 },
      ],
    });
    const total = out.transfers.reduce((s, t) => s + t.amountBaseUnits, 0n);
    expect(total).toBe(amount);
    expect(out.transfers).toHaveLength(5);
    // Last recipient (lowest priority absorbs remainder)
    expect(out.remainderAbsorbedByUsername).toBe('sampleclear');
  });

  it('throws if a recipient has neither internal wallet nor external address', () => {
    expect(() =>
      decideSplit({
        paymentId: 'p',
        amountUsdcBaseUnits: amount,
        recipients: [
          { username: 'x', walletAddress: null, externalAddress: null, recipientUserId: 'u1', role: 'artist', bps: 10000, payoutPriority: 100 },
        ],
      }),
    ).toThrow();
  });
});