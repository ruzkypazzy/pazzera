/**
 * Phase 9 — Mock Circle provider.
 *
 * Deterministic, in-memory. Use for:
 *   - tests
 *   - dev runs without CIRCLE_API_KEY
 *   - demo mode (where we want synthetic settlement that looks real)
 *
 * Behavior:
 *   - createWallet:    returns a 0x...40 address derived from userId (so the
 *                      same user always gets the same address).
 *   - fetchBalance:    returns a stub balance scaled to the walletId hash.
 *   - prepareTransfer: marks pending, auto-submits, returns txHash after 100ms.
 *   - settleX402:      same: verifies the signature shape, then "confirms".
 *
 * The mock never persists across process restarts — fresh state every boot.
 */
import { createHash, randomBytes } from 'node:crypto';
import { type Address, type Hex } from 'viem';
import {
  type CircleProvider,
  type CircleCreateWalletInput,
  type CircleCreateWalletResult,
  type CircleFetchWalletResult,
  type CircleBalanceResult,
  type CirclePrepareTransferInput,
  type CirclePrepareTransferResult,
  type CircleTransferStatusResult,
  type CircleX402SettleInput,
  type CircleX402SettleResult,
  CircleError,
  withRetry,
} from './provider';
import { verifyAuthorizationSignature } from '../x402/verify';

interface MockWallet {
  walletId: string;
  userId: string;
  address: Address;
  status: 'live' | 'frozen' | 'pending';
  balanceBaseUnits: bigint;
  createdAt: Date;
}
interface MockTransfer {
  transferId: string;
  walletId: string;
  amountBaseUnits: bigint;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  blockNumber?: number;
  submittedAt?: Date;
  confirmedAt?: Date;
  failureReason?: string;
}

export class CircleMockProvider implements CircleProvider {
  readonly name = 'circle-mock';
  private wallets = new Map<string, MockWallet>();
  /** index by userId for idempotency */
  private byUserId = new Map<string, string>();
  private transfers = new Map<string, MockTransfer>();
  /** simulated settle latency (ms) */
  public settleLatencyMs = 100;
  /** simulated transfer latency (ms) */
  public transferLatencyMs = 120;
  /** Force-fail behavior for tests */
  public failureRate = 0; // 0..1

  async createWallet(input: CircleCreateWalletInput): Promise<CircleCreateWalletResult> {
    const existing = this.byUserId.get(input.userId);
    if (existing) {
      const w = this.wallets.get(existing)!;
      return {
        walletId: w.walletId,
        address: w.address,
        custody: 'user',
        providerMetadata: { idempotency_key: input.idempotencyKey ?? null, mock: true },
        createdAt: w.createdAt,
      };
    }
    // Deterministic address
    const h = createHash('sha256').update(`mock-wallet:${input.userId}`).digest('hex');
    const address = `0x${h.slice(0, 40)}` as Address;
    const walletId = `mock-wallet-${h.slice(0, 16)}`;
    const now = new Date();
    const wallet: MockWallet = {
      walletId,
      userId: input.userId,
      address,
      status: 'live',
      balanceBaseUnits: 1_000_000n * 1000n, // 1000 USDC starting balance (demo mode)
      createdAt: now,
    };
    this.wallets.set(walletId, wallet);
    this.byUserId.set(input.userId, walletId);
    return {
      walletId,
      address,
      custody: 'user',
      providerMetadata: { mock: true, idempotency_key: input.idempotencyKey ?? null },
      createdAt: now,
    };
  }

  async fetchWallet(walletId: string): Promise<CircleFetchWalletResult | null> {
    const w = this.wallets.get(walletId);
    if (!w) return null;
    return { walletId: w.walletId, address: w.address, status: w.status, createdAt: w.createdAt };
  }

  async fetchBalance(walletIdOrAddress: string): Promise<CircleBalanceResult> {
    const w = this.find(walletIdOrAddress);
    if (!w) {
      // Lookup-only mode (no auth needed) — return 0
      return {
        walletId: walletIdOrAddress,
        address: walletIdOrAddress as Address,
        balanceUsdc: '0',
        balanceBaseUnits: '0',
        blockNumber: this.fakeBlock(),
        chainId: 5042002,
      };
    }
    return {
      walletId: w.walletId,
      address: w.address,
      balanceUsdc: baseUnitsToUsdc(w.balanceBaseUnits),
      balanceBaseUnits: w.balanceBaseUnits.toString(),
      blockNumber: this.fakeBlock(),
      chainId: 5042002,
    };
  }

  async prepareTransfer(input: CirclePrepareTransferInput): Promise<CirclePrepareTransferResult> {
    return withRetry(async () => {
      const w = this.wallets.get(input.walletId);
      if (!w) throw new CircleError('wallet not found', 404, 'NOT_FOUND', false);
      if (w.balanceBaseUnits < BigInt(input.amountBaseUnits)) {
        throw new CircleError('insufficient balance', 422, 'INSUFFICIENT_BALANCE', false);
      }
      const transferId = `mock-tx-${randomBytes(12).toString('hex')}`;
      const tx: MockTransfer = {
        transferId,
        walletId: w.walletId,
        amountBaseUnits: BigInt(input.amountBaseUnits),
        status: 'confirmed', // mock auto-confirms within the prepare call
        txHash: `0x${randomBytes(32).toString('hex')}`,
        blockNumber: this.fakeBlock(),
        submittedAt: new Date(),
        confirmedAt: new Date(),
      };
      w.balanceBaseUnits -= BigInt(input.amountBaseUnits);
      this.transfers.set(transferId, tx);
      return this.asPrepareResult(tx);
    });
  }

  async submitTransfer(transferId: string): Promise<CirclePrepareTransferResult> {
    const tx = this.transfers.get(transferId);
    if (!tx) throw new CircleError('transfer not found', 404, 'NOT_FOUND', false);
    return this.asPrepareResult(tx);
  }

  async fetchTransfer(transferId: string): Promise<CircleTransferStatusResult> {
    const tx = this.transfers.get(transferId);
    if (!tx) throw new CircleError('transfer not found', 404, 'NOT_FOUND', false);
    return {
      transferId: tx.transferId,
      status: tx.status,
      txHash: tx.txHash,
      blockNumber: tx.blockNumber,
      confirmedAt: tx.confirmedAt,
      failureReason: tx.failureReason,
    };
  }

  async settleX402(input: CircleX402SettleInput): Promise<CircleX402SettleResult> {
    return withRetry(async () => {
      if (this.failureRate > 0 && Math.random() < this.failureRate) {
        throw new CircleError('mock settlement failure', 503, 'MOCK_FAIL', true);
      }
      // Verify the signature
      const verified = await verifyAuthorizationSignature({
        from: input.authorization.from,
        to: input.authorization.to,
        value: input.authorization.value,
        validAfter: input.authorization.validAfter,
        validBefore: input.authorization.validBefore,
        nonce: input.authorization.nonce,
        v: input.authorization.v,
        r: input.authorization.r,
        s: input.authorization.s,
      });
      if (!verified.valid) {
        throw new CircleError(`signature invalid: ${verified.reason}`, 422, 'INVALID_SIGNATURE', false);
      }
      await new Promise((r) => setTimeout(r, this.settleLatencyMs));
      const transferId = `mock-x402-${randomBytes(12).toString('hex')}`;
      const txHash = `0x${randomBytes(32).toString('hex')}`;
      return {
        transferId,
        status: 'confirmed',
        txHash,
        blockNumber: this.fakeBlock(),
        confirmedAt: new Date(),
      };
    });
  }

  async healthCheck() {
    return { ok: true, latencyMs: 0 };
  }

  // ─── Test helpers ─────────────────────────────────────────
  /** Drain state (for test isolation). */
  reset() {
    this.wallets.clear();
    this.byUserId.clear();
    this.transfers.clear();
  }

  // ─── Internal ────────────────────────────────────────────
  private find(id: string): MockWallet | undefined {
    return this.wallets.get(id) ?? [...this.wallets.values()].find((w) => w.address === id);
  }
  private fakeBlock(): number {
    return 1_000_000 + Math.floor(Date.now() / 12_000);
  }
  private asPrepareResult(tx: MockTransfer): CirclePrepareTransferResult {
    return {
      transferId: tx.transferId,
      status: tx.status,
      amountBaseUnits: tx.amountBaseUnits.toString(),
      txHash: tx.txHash,
      blockNumber: tx.blockNumber,
      confirmedAt: tx.confirmedAt,
      submittedAt: tx.submittedAt,
      failureReason: tx.failureReason,
    };
  }
}

/** Decimal-string BigInt → human-readable USDC (6 decimals). */
function baseUnitsToUsdc(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (fracStr.length === 0 ? whole.toString() : `${whole}.${fracStr}`);
}

// Module-scope singleton for production code that imports "the active mock".
export const mockCircleProvider = new CircleMockProvider();
