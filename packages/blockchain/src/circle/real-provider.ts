/**
 * Phase 9 — Real Circle W3S + Gateway REST adapter.
 *
 * Implements the same interface as `mock-provider.ts`. Hits Circle APIs:
 *   POST {CIRCLE_BASE_URL}/v1/w3s/wallets
 *   GET  {CIRCLE_BASE_URL}/v1/w3s/wallets/:id
 *   GET  {CIRCLE_BASE_URL}/v1/w3s/wallets/:id/balances
 *   POST {CIRCLE_BASE_URL}/v1/w3s/transfers/developer
 *   GET  {CIRCLE_BASE_URL}/v1/w3s/transfers/:id
 *   POST {GATEWAY_URL}/v1/x402/settle
 *
 * All requests include the bearer auth header + idempotency key where safe.
 * Retries use exponential backoff for 429 + 5xx only (4xx is terminal).
 */
import { type Address, type Hex } from 'viem';
import { randomBytes } from 'node:crypto';
import { getEnv, logger } from '@pazzera/core';
import {
  CircleError,
  withRetry,
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
} from './provider';

interface FetchOptions {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  body?: unknown;
  idempotencyKey?: string;
}

export class CircleRealProvider implements CircleProvider {
  readonly name = 'circle-ucw';

  private get baseUrl() { return getEnv().CIRCLE_BASE_URL; }
  private get walletSetId() { return getEnv().CIRCLE_WALLET_SET_ID; }
  private get apiKey() { return getEnv().CIRCLE_API_KEY; }
  private get gatewayUrl() { return getEnv().CIRCLE_GATEWAY_FACILITATOR_URL; }

  async createWallet(input: CircleCreateWalletInput): Promise<CircleCreateWalletResult> {
    const idempotencyKey = input.idempotencyKey ?? randomBytes(16).toString('hex');
    const resp = await this.request<{ data?: CircleCreateWalletResult } & CircleCreateWalletResult>({
      method: 'POST',
      url: `${this.baseUrl}/v1/w3s/wallets`,
      body: {
        walletSetId: this.walletSetId,
        userId: input.userId,
        idempotencyKey,
      },
      idempotencyKey,
    });
    const account = (resp.data ?? resp) as unknown as CircleCreateWalletResult;
    return {
      walletId: account.walletId,
      address: account.address,
      custody: 'user',
      providerMetadata: { mock: false, ...account.providerMetadata },
      createdAt: new Date(account.createdAt),
    };
  }

  async fetchWallet(walletId: string): Promise<CircleFetchWalletResult | null> {
    try {
      const r = await this.request<CircleFetchWalletResult>({
        method: 'GET',
        url: `${this.baseUrl}/v1/w3s/wallets/${walletId}`,
      });
      return r;
    } catch (err) {
      if (err instanceof CircleError && err.status === 404) return null;
      throw err;
    }
  }

  async fetchBalance(walletIdOrAddress: string): Promise<CircleBalanceResult> {
    const r = await this.request<CircleBalanceResult>({
      method: 'GET',
      url: `${this.baseUrl}/v1/w3s/wallets/${walletIdOrAddress}/balances`,
    });
    return r;
  }

  async prepareTransfer(input: CirclePrepareTransferInput): Promise<CirclePrepareTransferResult> {
    const idempotencyKey = randomBytes(16).toString('hex');
    const r = await this.request<CirclePrepareTransferResult>({
      method: 'POST',
      url: `${this.baseUrl}/v1/w3s/transfers/developer`,
      body: {
        walletId: input.walletId,
        destination: input.destination,
        amounts: ['USDC'],
        amount: input.amountBaseUnits,
        network: input.network,
        memo: input.memo,
      },
      idempotencyKey,
    });
    return r;
  }

  async submitTransfer(transferId: string): Promise<CirclePrepareTransferResult> {
    const r = await this.request<CirclePrepareTransferResult>({
      method: 'POST',
      url: `${this.baseUrl}/v1/w3s/transfers/${transferId}/submit`,
    });
    return r;
  }

  async fetchTransfer(transferId: string): Promise<CircleTransferStatusResult> {
    const r = await this.request<CircleTransferStatusResult>({
      method: 'GET',
      url: `${this.baseUrl}/v1/w3s/transfers/${transferId}`,
    });
    return r;
  }

  async settleX402(input: CircleX402SettleInput): Promise<CircleX402SettleResult> {
    const idempotencyKey = randomBytes(16).toString('hex');
    const r = await this.request<CircleX402SettleResult>({
      method: 'POST',
      url: `${this.gatewayUrl}/v1/x402/settle`,
      body: { authorization: input.authorization, network: input.network },
      idempotencyKey,
    });
    return r;
  }

  async healthCheck() {
    const start = Date.now();
    try {
      await this.request<unknown>({ method: 'GET', url: `${this.baseUrl}/v1/w3s/health` });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, message: (err as Error).message };
    }
  }

  // ─── internal HTTP helper ─────────────────────────────────
  private async request<T>(opts: FetchOptions): Promise<T> {
    return withRetry(async () => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
      const res = await fetch(opts.url, {
        method: opts.method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // not JSON
      }
      if (!res.ok) {
        const code =
          (json as { code?: string; errorCode?: string })?.code
          ?? (json as { errorCode?: string })?.errorCode
          ?? `http_${res.status}`;
        const retryable = res.status === 429 || res.status >= 500;
        throw new CircleError(
          `Circle ${opts.method} ${new URL(opts.url).pathname} failed: ${res.status}`,
          res.status,
          code,
          retryable,
          json,
        );
      }
      return json as T;
    }, { attempts: 4, baseDelayMs: 800, maxDelayMs: 8_000 });
  }
}
