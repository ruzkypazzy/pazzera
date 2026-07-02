/**
 * Phase 9 — Circle UCW provider interface.
 *
 * Two implementations:
 *   - CircleMockProvider — deterministic, no network, perfect for tests + dev
 *   - CircleRealProvider — uses Circle W3S REST + Gateway facilitator
 *
 * Both implement the same interface. The factory in `factory.ts` selects
 * based on env (CIRCLE_API_KEY presence).
 */
import { type Address, type Hex } from 'viem';

export interface CircleCreateWalletInput {
  userId: string;
  /** Optional idempotency token (recommended for retry safety). */
  idempotencyKey?: string;
}

export interface CircleCreateWalletResult {
  walletId: string;
  address: Address;
  // Circle W3S API returns 'DEVELOPER' for DCW (developer owns the keys via
  // their entity secret + walletSet) and 'END_USER' / 'USER' for UCW (the
  // human user owns recovery via PIN / social / device key). We keep the
  // field stringly-typed so the real adapter can pass through whatever
  // Circle returns, and downstream code dispatches on it.
  custody: 'DEVELOPER' | 'END_USER' | 'USER' | 'user' | string;
  providerMetadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CircleFetchWalletResult {
  walletId: string;
  address: Address;
  status: 'live' | 'frozen' | 'pending';
  createdAt: Date;
}

export interface CircleBalanceResult {
  walletId: string;
  address: Address;
  balanceUsdc: string;          // decimal string in USDC
  balanceBaseUnits: string;     // raw bigint as string
  blockNumber: number;
  chainId: number;
}

export interface CirclePrepareTransferInput {
  walletId: string;
  /** Destination wallet id (internal) or external address. */
  destination: { kind: 'walletId' | 'address'; value: string };
  /** USDC amount in base units (string for bigint safety). */
  amountBaseUnits: string;
  memo?: string;
  /** Network ID, e.g. "eip155:5042002". */
  network: string;
}

export interface CirclePrepareTransferResult {
  transferId: string;
  /** Status of a freshly-created transfer. */
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  amountBaseUnits: string;
  txHash?: string;
  blockNumber?: number;
  /** Time the on-chain confirm was seen. */
  confirmedAt?: Date;
  submittedAt?: Date;
  failureReason?: string;
}

export interface CircleTransferStatusResult {
  transferId: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'reversed';
  txHash?: string;
  blockNumber?: number;
  confirmedAt?: Date;
  failureReason?: string;
}

export interface CircleX402SettleInput {
  /** Signed EIP-3009 envelope. */
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  };
  /** Network, e.g. "eip155:5042002". */
  network: string;
}

export interface CircleX402SettleResult {
  /** Circle's internal transfer ID — used for status polling. */
  transferId: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  blockNumber?: number;
  confirmedAt?: Date;
  failureReason?: string;
}

export interface CircleProvider {
  readonly name: string;

  /** Wallet CRUD. */
  createWallet(input: CircleCreateWalletInput): Promise<CircleCreateWalletResult>;
  fetchWallet(walletId: string): Promise<CircleFetchWalletResult | null>;
  fetchBalance(walletIdOrAddress: string): Promise<CircleBalanceResult>;

  /** Direct transfer (server-driven). Used by Split Agent after payout. */
  prepareTransfer(input: CirclePrepareTransferInput): Promise<CirclePrepareTransferResult>;
  submitTransfer(transferId: string): Promise<CirclePrepareTransferResult>;
  fetchTransfer(transferId: string): Promise<CircleTransferStatusResult>;

  /** x402 — facilitator-mediated nano-payment settlement. */
  settleX402(input: CircleX402SettleInput): Promise<CircleX402SettleResult>;

  /** Health. */
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; message?: string }>;
}

/** Convenience error wrapper — every adapter throws this on a non-2xx. */
export class CircleError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'CircleError';
  }
}

/** Common retry helper with exponential backoff + jitter. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 4_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRetryable = err instanceof CircleError ? err.retryable : true;
      if (i === attempts - 1 || !isRetryable) throw err;
      const delay = Math.min(max, base * 2 ** i + Math.floor(Math.random() * base));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Hex helpers. */
export function toAddress(s: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) throw new Error(`Not an address: ${s}`);
  return s as Address;
}

export function toHex32(s: string): Hex {
  const t = s.startsWith('0x') ? s.slice(2) : s;
  if (t.length !== 64) throw new Error(`Not 32-byte hex: ${s}`);
  return `0x${t}` as Hex;
}
