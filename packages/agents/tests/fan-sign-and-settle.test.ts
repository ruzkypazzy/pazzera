/**
 * Phase 10 + Fix 3 — server-side x402 sign-and-settle.
 *
 * Unit tests for `runSignAndSettle` exported from
 * packages/agents/src/workers/fan-worker.ts. Mocks the
 * @pazzera/blockchain package (WalletService + FacilitatorService) and
 * the realtime helpers so the test runs without a live Circle or DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @pazzera/blockchain — only WalletService and FacilitatorService
// are touched in runSignAndSettle.
const mockSign = vi.fn();
const mockSettle = vi.fn();

vi.mock('@pazzera/blockchain', () => ({
  WalletService: { signX402Authorization: mockSign },
  FacilitatorService: { settle: mockSettle },
}));

// Mock @pazzera/blockchain/services/eip712 (newNonce). It's only
// imported as a function, no side effects.
vi.mock('@pazzera/blockchain/services/eip712', () => ({
  newNonce: () => '0x' + 'a'.repeat(64),
}));

// Mock @pazzera/blockchain/adapters/usdc (usdcToBaseUnits).
vi.mock('@pazzera/blockchain/adapters/usdc', () => ({
  usdcToBaseUnits: (s: string) => BigInt(Math.round(Number(s) * 1_000_000)),
}));

// Mock @pazzera/realtime — issue/emit helpers. The runtime path uses
// a dynamic import so we can swap the underlying module.
const mockIssueAndStoreNonce = vi.fn(async () => 'n_test_nonce');
const mockEmitPaymentDue = vi.fn(async () => undefined);
const mockEmitPaymentSettled = vi.fn(async () => undefined);
const mockEmitPaymentFailed = vi.fn(async () => undefined);

vi.mock('@pazzera/realtime', () => ({
  issueAndStoreNonce: mockIssueAndStoreNonce,
  emitPaymentDue: mockEmitPaymentDue,
  emitPaymentSettled: mockEmitPaymentSettled,
  emitPaymentFailed: mockEmitPaymentFailed,
}));

// Mock prisma — a tiny in-memory shim.
const wallets = new Map<string, any>();
const songs = new Map<string, any>();
const payments = new Map<string, any>();
const paymentEvents: any[] = [];

vi.mock('@pazzera/db', () => {
  return {
    prisma: {
      wallet: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.userId) return wallets.get(where.userId) ?? null;
          return null;
        }),
      },
      song: {
        findUnique: vi.fn(async ({ where, select }: any) => {
          const song = songs.get(where.id);
          if (!song) return null;
          if (!select) return song;
          const out: any = {};
          for (const k of Object.keys(select)) out[k] = song[k];
          return out;
        }),
      },
      payment: {
        create: vi.fn(async ({ data }: any) => {
          const id = `pay_${payments.size + 1}`;
          const row = { id, ...data };
          payments.set(id, row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const existing = payments.get(where.id);
          if (!existing) throw new Error('not found');
          Object.assign(existing, data);
          return existing;
        }),
        // The real FacilitatorService.settle() updates Payment.status
        // to 'settled' (with txHash) or 'failed' on its own. The test
        // mock for settle() handles the side effects, so the prisma
        // .update call from inside settle() is reflected here.
      },
      paymentEvent: {
        create: vi.fn(async ({ data }: any) => {
          paymentEvents.push(data);
          return data;
        }),
      },
    },
  };
});

vi.mock('@pazzera/core', () => ({
  getEnv: () => ({
    ARC_CHAIN_ID: '5042002',
    USDC_CONTRACT_ADDRESS: '0x3600000000000000000000000000000000000000',
    NODE_ENV: 'test',
  }),
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const { runSignAndSettle } = await import('../src/workers/fan-worker');

beforeEach(() => {
  wallets.clear();
  songs.clear();
  payments.clear();
  paymentEvents.length = 0;
  mockSign.mockReset();
  mockSettle.mockReset();
  mockIssueAndStoreNonce.mockReset();
  mockEmitPaymentDue.mockReset();
  mockEmitPaymentSettled.mockReset();
  mockEmitPaymentFailed.mockReset();
});

describe('runSignAndSettle (Phase 10 + Fix 3)', () => {
  it('happy path: signs, creates Payment row, settles, emits payment_settled', async () => {
    const listenerAddr = '0x1111111111111111111111111111111111111111';
    const artistAddr = '0x2222222222222222222222222222222222222222';
    wallets.set('user_listener', {
      id: 'w_listener',
      userId: 'user_listener',
      address: listenerAddr,
      status: 'active',
      provider: 'circle-dcw',
    });
    songs.set('song_1', {
      id: 'song_1',
      artistId: 'user_artist',
      publishedPriceUsdc: '0.003',
    });
    wallets.set('user_artist', {
      id: 'w_artist',
      userId: 'user_artist',
      address: artistAddr,
      status: 'active',
    });
    mockSign.mockResolvedValue({ v: 27, r: '0x' + 'a'.repeat(64), s: '0x' + 'b'.repeat(64), platformSigned: true });
    mockSettle.mockImplementation(async ({ paymentId }: { paymentId: string }) => {
      // Mirror the real FacilitatorService.settle: update Payment row
      // to 'settled' on success.
      const row = payments.get(paymentId);
      if (row) {
        row.status = 'settled';
        row.txHash = '0x' + 'c'.repeat(64);
      }
      return {
        ok: true,
        txHash: '0x' + 'c'.repeat(64),
        blockNumber: 12345,
        facilitatorTransferId: 'xfer_1',
        amountUsdc: '0.003',
        latencyMs: 100,
      };
    });

    await runSignAndSettle({
      streamId: 'stream_1',
      userId: 'user_listener',
      songId: 'song_1',
      amountUsdc: '0.003',
      classification: 'valid_stream',
    });

    // payment_due emitted, payment_settled emitted, payment_failed NOT emitted
    expect(mockEmitPaymentDue).toHaveBeenCalledOnce();
    expect(mockEmitPaymentSettled).toHaveBeenCalledOnce();
    expect(mockEmitPaymentFailed).not.toHaveBeenCalled();

    // Payment row created with status pending then settled
    expect(payments.size).toBe(1);
    const payment = [...payments.values()][0];
    expect(payment.status).toBe('settled');
    expect(payment.payerUserId).toBe('user_listener');
    expect(payment.songId).toBe('song_1');
    expect(payment.amountUsdc).toBe('0.003');
    expect(payment.amountBaseUnits).toBe('3000');
  });

  it('settlement failure: emits payment_failed, marks payment failed, no settled event', async () => {
    const listenerAddr = '0x1111111111111111111111111111111111111111';
    const artistAddr = '0x2222222222222222222222222222222222222222';
    wallets.set('user_listener', { id: 'w_l', userId: 'user_listener', address: listenerAddr, status: 'active' });
    wallets.set('user_artist', { id: 'w_a', userId: 'user_artist', address: artistAddr, status: 'active' });
    songs.set('song_1', { id: 'song_1', artistId: 'user_artist', publishedPriceUsdc: '0.003' });
    mockSign.mockResolvedValue({ v: 27, r: '0x' + 'a'.repeat(64), s: '0x' + 'b'.repeat(64), platformSigned: true });
    mockSettle.mockResolvedValue({
      ok: false,
      reason: 'chain_error',
      retryable: true,
      latencyMs: 50,
    });

    await runSignAndSettle({
      streamId: 'stream_2',
      userId: 'user_listener',
      songId: 'song_1',
      amountUsdc: '0.003',
      classification: 'valid_stream',
    });

    expect(mockEmitPaymentFailed).toHaveBeenCalledOnce();
    expect(mockEmitPaymentSettled).not.toHaveBeenCalled();
    const payment = [...payments.values()][0];
    expect(payment.status).toBe('failed');
  });

  it('signing failure (cap exceeded): emits payment_failed with rate_limited, no settle call', async () => {
    const listenerAddr = '0x1111111111111111111111111111111111111111';
    const artistAddr = '0x2222222222222222222222222222222222222222';
    wallets.set('user_listener', { id: 'w_l', userId: 'user_listener', address: listenerAddr, status: 'active' });
    wallets.set('user_artist', { id: 'w_a', userId: 'user_artist', address: artistAddr, status: 'active' });
    songs.set('song_1', { id: 'song_1', artistId: 'user_artist', publishedPriceUsdc: '0.003' });
    mockSign.mockRejectedValue(
      Object.assign(new Error('Per-stream x402 cap exceeded'), { code: 'CONFLICT' }),
    );

    await runSignAndSettle({
      streamId: 'stream_3',
      userId: 'user_listener',
      songId: 'song_1',
      amountUsdc: '0.003',
      classification: 'valid_stream',
    });

    expect(mockSettle).not.toHaveBeenCalled();
    expect(mockEmitPaymentFailed).toHaveBeenCalledOnce();
    expect(mockEmitPaymentFailed.mock.calls[0][0]).toBe('stream_3');
    expect(mockEmitPaymentFailed.mock.calls[0][1]).toBe('rate_limited');
  });

  it('missing listener wallet: emits payment_failed, no sign, no settle', async () => {
    songs.set('song_1', { id: 'song_1', artistId: 'user_artist', publishedPriceUsdc: '0.003' });
    // No listener wallet

    await runSignAndSettle({
      streamId: 'stream_4',
      userId: 'user_missing',
      songId: 'song_1',
      amountUsdc: '0.003',
      classification: 'valid_stream',
    });

    expect(mockSign).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
    expect(mockEmitPaymentFailed).toHaveBeenCalledOnce();
    expect(payments.size).toBe(0);
  });
});
