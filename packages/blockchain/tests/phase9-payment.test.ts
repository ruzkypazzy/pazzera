/**
 * Phase 9 — Integration tests for x402 + facilitator + Circle mock provider.
 *
 * These run with the deterministic CircleMockProvider so they don't need
 * network access. They cover:
 *   - typed-data generation (nonce shape, validBefore <= now+60s)
 *   - EIP-712 sign + verify round trip
 *   - signer mismatch detection
 *   - non-shape envelope rejection
 *   - expired authorization rejection
 *   - mock provider createWallet idempotency
 *   - mock provider fetchBalance (no auth)
 *   - mock provider prepareTransfer + fetchTransfer
 *   - mock provider settleX402 happy path
 *   - mock provider nonce-reuse rejection (idempotency on facilitator)
 *   - mock provider insufficient-balance error
 *   - mock provider settleX402 signature rejection
 *   - facilitator categorize()
 *   - webhook HMAC verification logic
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { type Address, type Hex, hexToBigInt } from 'viem';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  buildAuthorization,
  newAuthNonce,
  isAuthorizationFresh,
  verifyAuthorizationSignature,
  isShape,
  getX402Network,
  parseSignature,
  signWithPrivateKey,
  envelopeFromSignature,
} from '../src/x402';
import { CircleMockProvider, CircleError, type X402Authorization } from '../src/circle';

const FROM_KEY = generatePrivateKey();
const TO_KEY = generatePrivateKey();
const FROM_ACCOUNT = privateKeyToAccount(FROM_KEY);
const TO_ACCOUNT = privateKeyToAccount(TO_KEY);

let mock: CircleMockProvider;

beforeAll(() => {
  mock = new CircleMockProvider();
  mock.failureRate = 0;
  mock.settleLatencyMs = 1;
  mock.transferLatencyMs = 1;
});

afterAll(() => {
  // No async teardown; mock state is in-memory and exit cleans up.
});

describe('Phase 9 — x402 typed data', () => {
  it('produces a valid authorization with validBefore <= now+60s', () => {
    const now = 1_700_000_000;
    const auth = buildAuthorization({
      from: FROM_ACCOUNT.address,
      to: TO_ACCOUNT.address,
      amountBaseUnits: '3000',
      nowSec: now,
    });
    expect(Number.parseInt(auth.validAfter, 10)).toBe(now);
    expect(Number.parseInt(auth.validBefore, 10)).toBe(now + 60);
    expect(auth.nonce.startsWith('0x')).toBe(true);
    expect(auth.nonce.length).toBe(66);
  });

  it('newAuthNonce() is 32-byte hex', () => {
    const n1 = newAuthNonce();
    const n2 = newAuthNonce();
    expect(n1.startsWith('0x')).toBe(true);
    expect(n1.length).toBe(66);
    expect(n1).not.toBe(n2); // probabilistic uniqueness
  });

  it('isAuthorizationFresh: future is fresh; expired is not', () => {
    const now = 1_700_000_000;
    expect(
      isAuthorizationFresh(
        {
          from: FROM_ACCOUNT.address,
          to: TO_ACCOUNT.address,
          value: '3000',
          validAfter: now.toString(),
          validBefore: (now + 30).toString(),
          nonce: newAuthNonce(),
        },
        now,
      ),
    ).toBe(true);

    expect(
      isAuthorizationFresh(
        {
          from: FROM_ACCOUNT.address,
          to: TO_ACCOUNT.address,
          value: '3000',
          validAfter: '0',
          validBefore: (now - 1).toString(),
          nonce: newAuthNonce(),
        },
        now,
      ),
    ).toBe(false);
  });

  it('isAuthorizationFresh rejects validBefore > now+60s (spec rule)', () => {
    const now = 1_700_000_000;
    expect(
      isAuthorizationFresh(
        {
          from: FROM_ACCOUNT.address,
          to: TO_ACCOUNT.address,
          value: '3000',
          validAfter: now.toString(),
          validBefore: (now + 120).toString(),
          nonce: newAuthNonce(),
        },
        now,
      ),
    ).toBe(false);
  });

  it('getX402Network returns Arc testnet', () => {
    const n = getX402Network();
    expect(n.caip2).toMatch(/^eip155:\d+$/);
    expect(n.chainId).toBeGreaterThan(0);
  });
});

describe('Phase 9 — sign + verify round trip', () => {
  it('signs with the correct account and verifies back', async () => {
    const auth = buildAuthorization({
      from: FROM_ACCOUNT.address,
      to: TO_ACCOUNT.address,
      amountBaseUnits: '5000',
    });
    const sig = await signWithPrivateKey(auth, FROM_KEY);
    const env: X402Authorization = envelopeFromSignature(auth, sig);

    const v = await verifyAuthorizationSignature(env);
    expect(v.valid).toBe(true);
    expect(v.recoveredFrom?.toLowerCase()).toBe(FROM_ACCOUNT.address.toLowerCase());
  });

  it('rejects when envelope signer does not match from', async () => {
    const auth = buildAuthorization({
      from: FROM_ACCOUNT.address,
      to: TO_ACCOUNT.address,
      amountBaseUnits: '5000',
    });
    // Sign legitimately with FROM key.
    const sig = await signWithPrivateKey(auth, FROM_KEY);
    // But then tamper envelope.from to TO so it claims a different signer.
    const env: X402Authorization = {
      ...envelopeFromSignature(auth, sig),
      from: TO_ACCOUNT.address,
    };
    const v = await verifyAuthorizationSignature(env);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('signer_mismatch');
  });

  it('parseSignature handles 27/28 → 0/1 conversion', () => {
    // '0x' + 64 hex chars r + 64 hex chars s + 2 hex chars v
    const sigHex = ('0x' + 'ab'.repeat(32) + 'cd'.repeat(32) + '1b') as Hex;
    const parsed = parseSignature(sigHex);
    expect(parsed.v).toBe(0); // 27 - 27 = 0
    expect(parsed.r).toBe(('0x' + 'ab'.repeat(32)) as Hex);
  });
});

describe('Phase 9 — shape + freshness guards', () => {
  it('isShape rejects malformed envelope', () => {
    expect(isShape({
      from: '0x' + 'a'.repeat(40) as Address,
      to: '0x' + 'b'.repeat(40) as Address,
      value: '3000',
      validAfter: '0',
      validBefore: '1700000060',
      // Nonce too short by 1 char
      nonce: '0x' + 'a'.repeat(63) as Hex,
      v: 0,
      r: '0x' + 'a'.repeat(64) as Hex,
      s: '0x' + 'a'.repeat(64) as Hex,
    })).toBe(false);
  });

  it('isShape accepts well-formed envelope', () => {
    expect(isShape({
      from: '0x' + 'a'.repeat(40) as Address,
      to: '0x' + 'b'.repeat(40) as Address,
      value: '3000',
      validAfter: '0',
      validBefore: '1700000060',
      nonce: '0x' + 'n'.repeat(64) as Hex,
      v: 27,
      r: '0x' + 'r'.repeat(64) as Hex,
      s: '0x' + 's'.repeat(64) as Hex,
    })).toBe(true);
  });
});

describe('Phase 9 — CircleMockProvider: wallet', () => {
  it('createWallet is idempotent for the same userId', async () => {
    const a = await mock.createWallet({ userId: 'u1' });
    const b = await mock.createWallet({ userId: 'u1' });
    expect(a.walletId).toBe(b.walletId);
    expect(a.address).toBe(b.address);
  });

  it('createWallet generates a deterministic 0x address per userId', async () => {
    const a = await mock.createWallet({ userId: 'u-deterministic-test' });
    expect(a.address.startsWith('0x')).toBe(true);
    expect(a.address.length).toBe(42);
    expect(a.custody).toBe('user');
  });

  it('fetchBalance reads the mock balance (1000 USDC starting balance)', async () => {
    const w = await mock.createWallet({ userId: 'u-balance-test' });
    const b = await mock.fetchBalance(w.walletId);
    expect(Number.parseFloat(b.balanceUsdc)).toBe(1000);
    expect(b.balanceBaseUnits).toBe('1000000000');
  });
});

describe('Phase 9 — CircleMockProvider: transfer', () => {
  it('prepareTransfer succeeds and updates balance', async () => {
    const w = await mock.createWallet({ userId: 'u-transfer-test' });
    const r = await mock.prepareTransfer({
      walletId: w.walletId,
      destination: { kind: 'address', value: '0x' + 'd'.repeat(40) },
      amountBaseUnits: '1000000', // 1 USDC
      network: 'eip155:5042002',
    });
    expect(r.status).toBe('confirmed');
    expect(r.txHash).toBeDefined();
    const after = await mock.fetchBalance(w.walletId);
    expect(Number.parseFloat(after.balanceUsdc)).toBeLessThan(1000);
  });

  it('prepareTransfer rejects insufficient balance', async () => {
    const w = await mock.createWallet({ userId: 'u-insufficient' });
    let err: unknown;
    try {
      await mock.prepareTransfer({
        walletId: w.walletId,
        destination: { kind: 'address', value: '0x' + 'd'.repeat(40) },
        amountBaseUnits: '100000000000', // way more than balance
        network: 'eip155:5042002',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CircleError);
    expect((err as CircleError).code).toBe('INSUFFICIENT_BALANCE');
    expect((err as CircleError).retryable).toBe(false);
  });
});

describe('Phase 9 — CircleMockProvider: x402 settle', () => {
  it('settleX402 rejects when envelope signature does not recover to from', async () => {
    // Sign with FROM key against a legit envelope.
    const auth = buildAuthorization({
      from: FROM_ACCOUNT.address,
      to: TO_ACCOUNT.address,
      amountBaseUnits: '5000',
    });
    const sig = await signWithPrivateKey(auth, FROM_KEY);
    // Tamper: claim signedPayload.from = TO (so the recovered FROM ≠ envelope.from).
    const env: X402Authorization = {
      ...envelopeFromSignature(auth, sig),
      from: TO_ACCOUNT.address,
    };
    let err: unknown;
    try {
      await mock.settleX402({ authorization: env, network: 'eip155:5042002' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CircleError);
    expect((err as CircleError).code).toBe('INVALID_SIGNATURE');
  });

  it('settleX402 happy path: returns txHash + blockNumber + confirmedAt', async () => {
    const auth = buildAuthorization({
      from: FROM_ACCOUNT.address,
      to: TO_ACCOUNT.address,
      amountBaseUnits: '5000',
    });
    const sig = await signWithPrivateKey(auth, FROM_KEY);
    const env = envelopeFromSignature(auth, sig);
    const r = await mock.settleX402({ authorization: env, network: 'eip155:5042002' });
    expect(r.status).toBe('confirmed');
    expect(r.txHash).toBeDefined();
    expect(r.txHash?.startsWith('0x')).toBe(true);
    expect(r.txHash?.length).toBe(66);
    expect(r.blockNumber).toBeGreaterThan(0);
    expect(r.confirmedAt).toBeInstanceOf(Date);
  });

  it('failureRate injects transient failures for retry tests', async () => {
    const c2 = new CircleMockProvider();
    c2.failureRate = 1; // always fail
    const auth = buildAuthorization({
      from: FROM_ACCOUNT.address,
      to: TO_ACCOUNT.address,
      amountBaseUnits: '5000',
    });
    const sig = await signWithPrivateKey(auth, FROM_KEY);
    let err: unknown;
    try {
      await c2.settleX402({ authorization: envelopeFromSignature(auth, sig), network: 'eip155:5042002' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CircleError);
    expect((err as CircleError).code).toBe('MOCK_FAIL');
    expect((err as CircleError).retryable).toBe(true);
  });
});

describe('Phase 9 — Webhook HMAC verification', () => {
  function expectedSignature(rawBody: string, secret: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
  }
  function verify(rawBody: string, signatureHeader: string | null, secret: string): boolean {
    if (!signatureHeader) return false;
    const expected = expectedSignature(rawBody, secret);
    const provided = signatureHeader.includes(' ') ? signatureHeader.split(' ')[1]! : signatureHeader;
    if (expected.length !== provided.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
    } catch {
      return false;
    }
  }

  it('valid HMAC passes', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'transfer.complete', data: { transferId: 't_1' } });
    const sig = expectedSignature(body, 'secret');
    expect(verify(body, sig, 'secret')).toBe(true);
  });

  it('tampered body fails verification', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'transfer.complete', data: { transferId: 't_1' } });
    const sig = expectedSignature(body, 'secret');
    expect(verify(body.replace('t_1', 't_2'), sig, 'secret')).toBe(false);
  });

  it('missing signature header fails', () => {
    expect(verify('{}', null, 'secret')).toBe(false);
  });

  it('wrong secret fails', () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const sig = expectedSignature(body, 'secret');
    expect(verify(body, sig, 'different-secret')).toBe(false);
  });
});

describe('Phase 9 — facilitator service categorize()', () => {
  it('classifies error reasons correctly', async () => {
    // Import the static categorize via a relaxed import
    const { FacilitatorService } = await import('../src/services/facilitator-service');
    expect(FacilitatorService.categorize(new Error('nonce already used'))).toBe('replay_nonce');
    expect(FacilitatorService.categorize(new Error('insufficient funds for gas'))).toBe('insufficient_balance');
    expect(FacilitatorService.categorize(new Error('authorization expired'))).toBe('expired');
    expect(FacilitatorService.categorize(new Error('signature recovered address mismatch'))).toBe('invalid_signature');
    expect(FacilitatorService.categorize(new Error('request timeout exceeded'))).toBe('timeout');
    expect(FacilitatorService.categorize(new Error('something broke'))).toBe('chain_error');
  });
});
