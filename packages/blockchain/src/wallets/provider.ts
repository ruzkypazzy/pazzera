/**
 * WalletProvider — the contract every wallet implementation must satisfy.
 *
 * Pazzera is provider-agnostic. Today we ship three adapters:
 *   - CircleWalletProvider   (UCW, primary)
 *   - LocalDevWalletProvider  (for dev / hackathon demo without live API keys)
 *   - ArcNativeWalletProvider (placeholder; for a future Arc-native wallet
 *                              if/when Arc ships its own key-management API)
 *
 * The interface deliberately covers only what Pazzera needs:
 *   - createWallet:    provision a new user-controlled wallet
 *   - getBalance:      read on-chain USDC balance
 *   - transfer:        submit a USDC transfer signed by the wallet
 *   - signAuthorization: build an EIP-712 TransferWithAuthorization signature
 *                       for x402 nano payments (this is the "delegated spend"
 *                       path that does NOT give the platform custody)
 *   - rotate:          upgrade a wallet from one provider to another
 *                      (used during the optional DCW→UCW migration in dev)
 *
 * Philosophy (Option B — semi-custodial delegated auth):
 *   - The user owns the wallet address on Arc.
 *   - Pazzera never permanently holds withdrawal authority.
 *   - For x402 nano payments, the user signs a TransferWithAuthorization
 *     with a CAPPED scope (e.g. validBefore ≤ now+60s, value = price+ε,
 *     nonce burned on first use). This authorizes one specific payment.
 *   - If the user reports compromise, they revoke; settlement can't reuse
 *     the signed authorization because the nonce is consumed.
 */

export interface WalletProvisionInput {
  userId: string;
  /** Optional user metadata propagated to the provider (email, etc.) */
  metadata?: Record<string, string>;
}

export interface WalletProvisionResult {
  /** Provider-internal ID (e.g. Circle walletId). */
  providerWalletId: string;
  /** Arc / EVM address of the new wallet. */
  address: string;
  /** Set when the adapter is non-custodial (UCW) — the user owns the keys. */
  custody: 'user' | 'platform';
  /** Optional encrypted-blob for the platform to use its own signer; only set
   *  by the LocalDevWalletProvider, never by Circle UCW. */
  encryptedSecret?: string;
  /** Provider-specific metadata for later API calls. */
  providerMeta?: Record<string, unknown>;
}

export interface BalanceResult {
  address: string;
  /** USDC base units (6 decimals) as string. */
  balanceBaseUnits: string;
  /** USDC human-readable as string. */
  balanceUsdc: string;
  /** Block number of the read. */
  blockNumber: number;
}

export interface TransferInput {
  /** Source wallet address (must be owned by Pazzera for this user). */
  fromAddress: string;
  toAddress: string;
  /** Base units string (6 decimals). */
  amountBaseUnits: string;
  /** Optional memo / note. */
  memo?: string;
  /** If true, the adapter performs a gas estimation + broadcast; otherwise
   *  it returns a signed EIP-712 payload only. */
  submit?: boolean;
}

export interface TransferResult {
  txHash: string;
  blockNumber: number;
  status: 'submitted' | 'confirmed' | 'failed';
  /** True if the provider required on-platform signing (e.g. LocalDev). */
  platformSigned: boolean;
}

export interface SignAuthorizationInput {
  /** The wallet that signs. */
  walletAddress: string;
  to: string;
  valueBaseUnits: string;
  validAfter: number;
  validBefore: number;
  nonce: `0x${string}`;
  chainId: number;
  usdcContract: `0x${string}`;
}

export interface SignAuthorizationResult {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
  /** True if Pazzera (or its provider) signed — only true on LocalDev. */
  platformSigned: boolean;
}

export interface WalletProvider {
  /** Stable identifier used in DB column `Wallet.provider`. */
  readonly name: 'circle-ucw' | 'local-dev' | 'arc-native';

  /** Create a new wallet for the user. Idempotent per (provider, userId). */
  createWallet(input: WalletProvisionInput): Promise<WalletProvisionResult>;

  /** Read USDC balance. */
  getBalance(address: string): Promise<BalanceResult>;

  /** Initiate a USDC transfer. */
  transfer(input: TransferInput): Promise<TransferResult>;

  /** Build an EIP-712 TransferWithAuthorization signature (x402 path). */
  signAuthorization(input: SignAuthorizationInput): Promise<SignAuthorizationResult>;

  /**
   * Optional — check whether the provider currently supports nano-payments
   * via the x402 flow. UCW today requires client-side signing; we let the
   * adapter return false to disable x402.
   */
  supportsNanoPayments(): boolean;

  /** Optional — return a provider-side health snapshot (e.g. latency, errors). */
  healthCheck?(): Promise<{ ok: boolean; latencyMs: number; message?: string }>;
}
