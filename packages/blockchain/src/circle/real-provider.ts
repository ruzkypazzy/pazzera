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
import { randomBytes, randomUUID } from 'node:crypto';
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
import { getEntityPublicKey, encryptEntitySecret } from './entity-secret';

interface FetchOptions {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  body?: unknown;
  idempotencyKey?: string;
}

export class CircleRealProvider implements CircleProvider {
  readonly name = 'circle-dcw';

  private get baseUrl() { return getEnv().CIRCLE_BASE_URL; }
  private get walletSetId() { return getEnv().CIRCLE_WALLET_SET_ID; }
  private get apiKey() { return getEnv().CIRCLE_API_KEY; }
  private get entitySecret() { return getEnv().CIRCLE_ENTITY_SECRET; }
  private get gatewayUrl() { return getEnv().CIRCLE_GATEWAY_FACILITATOR_URL; }

  /**
   * Fetch Circle's RSA public key + encrypt the entity secret for the
   * current call. Each invocation returns a fresh ciphertext because
   * Circle rejects replays.
   */
  private async freshEntityCiphertext(): Promise<string> {
    const pem = await getEntityPublicKey({ baseUrl: this.baseUrl, apiKey: this.apiKey });
    return encryptEntitySecret(pem, this.entitySecret);
  }

  async createWallet(input: CircleCreateWalletInput): Promise<CircleCreateWalletResult> {
    // Circle requires UUID-format idempotencyKey. crypto.randomUUID() is
    // available on Node 19+; the caller's value is ignored.
    const idempotencyKey = randomUUID();
    const entitySecretCiphertext = await this.freshEntityCiphertext();
    // Circle's walletSetId is a strict UUID; some Pazzera envs use an
    // 'X' prefix that needs to be stripped (e.g. 'X622c08e4-...').
    const walletSetId = (this.walletSetId ?? '').replace(/^X/i, '');
    const resp = await this.request<{ data?: { wallets?: CircleCreateWalletResult[] } | CircleCreateWalletResult }>({
      method: 'POST',
      url: `${this.baseUrl}/v1/w3s/developer/wallets`,
      body: {
        idempotencyKey,
        blockchains: ['ARC-TESTNET'],
        entitySecretCiphertext,
        walletSetId,
        accountType: 'EOA',
        count: 1,
        metadata: [{ refId: input.userId }],
      },
      idempotencyKey,
    });
    // Response shape: { data: { wallets: [{ id, address, custodyType, ... }] } }
    const wrapper = (resp.data ?? resp) as unknown as
      | { wallets?: CircleCreateWalletResult[] }
      | CircleCreateWalletResult;
    const account = ('wallets' in wrapper && Array.isArray(wrapper.wallets) ? wrapper.wallets[0] : wrapper) as unknown as {
      id: string;
      walletId?: string;
      address: string;
      custodyType?: string;
      custody?: string;
    };
    return {
      walletId: account.walletId ?? account.id,
      address: account.address as Address,
      custody: (account.custody ?? account.custodyType ?? 'DEVELOPER') as CircleCreateWalletResult['custody'],
      providerMetadata: { mock: false, source: 'circle-dcw' },
      createdAt: new Date(),
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
    // Balance reads don't need entitySecretCiphertext.
    const r = await this.request<{ data?: CircleBalanceResult[] | CircleBalanceResult }>({
      method: 'GET',
      url: `${this.baseUrl}/v1/w3s/wallets/${walletIdOrAddress}/balances`,
    });
    const wrapper = (r.data ?? r) as unknown as CircleBalanceResult[] | CircleBalanceResult;
    if (Array.isArray(wrapper)) {
      return wrapper[0];
    }
    return wrapper;
  }

  async prepareTransfer(input: CirclePrepareTransferInput): Promise<CirclePrepareTransferResult> {
    const idempotencyKey = randomUUID();
    const entitySecretCiphertext = await this.freshEntityCiphertext();
    const walletSetId = (this.walletSetId ?? '').replace(/^X/i, '');
    // Circle's destination object: { kind, value } where kind is
    // 'address' or 'walletId'. For external withdrawals we always
    // pass kind='address' with the raw 0x... string.
    const dest = input.destination;
    const r = await this.request<CirclePrepareTransferResult>({
      method: 'POST',
      url: `${this.baseUrl}/v1/w3s/developer/transfers`,
      body: {
        idempotencyKey,
        entitySecretCiphertext,
        walletSetId,
        walletId: input.walletId,
        destination: dest.kind === 'address'
          ? { type: 'address', address: dest.value, chain: input.network ?? 'ARC-TESTNET' }
          : { type: 'walletId', walletId: dest.value },
        amounts: [input.amountBaseUnits],
        asset: 'USDC',
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

  async signTypedData(input: { walletId: string; typedData: unknown }): Promise<{ v: number; r: Hex; s: Hex }> {
    // Per Circle's docs (POST /v1/w3s/developer/sign/typedData):
    // the body requires walletId, entitySecretCiphertext,
    // idempotencyKey, and a `data` field that is the JSON-stringified
    // EIP-712 typed-data payload (NOT the object itself — Circle
    // string-parses it server-side). BigInts inside the payload must
    // be decimal strings (handled in `request()`).
    const idempotencyKey = randomUUID();
    const entitySecretCiphertext = await this.freshEntityCiphertext();
    const r = await this.request<{ data?: { signature?: string; v?: string | number; r?: string; s?: string } }>({
      method: 'POST',
      url: `${this.baseUrl}/v1/w3s/developer/sign/typedData`,
      body: {
        idempotencyKey,
        entitySecretCiphertext,
        walletId: input.walletId,
        // Circle expects `data` to be the JSON-stringified typedData,
        // with BigInts as decimal strings.
        data: JSON.stringify(input.typedData, (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      },
      idempotencyKey,
    });
    const data = r.data ?? (r as { signature?: string; v?: string | number; r?: string; s?: string });
    // Circle returns signature as a concatenated 0x{ r || s || v } hex
    // string in some versions, and split r/s/v in others. Handle both.
    if (data.signature) {
      const sig = data.signature.startsWith('0x') ? data.signature.slice(2) : data.signature;
      if (sig.length === 130) {
        return {
          r: ('0x' + sig.slice(0, 64)) as Hex,
          s: ('0x' + sig.slice(64, 128)) as Hex,
          v: parseInt(sig.slice(128, 130), 16),
        };
      }
    }
    return {
      r: (data.r ?? '0x') as Hex,
      s: (data.s ?? '0x') as Hex,
      v: typeof data.v === 'string' ? parseInt(data.v, 16) : (data.v ?? 0),
    };
  }

  async settleX402(input: CircleX402SettleInput): Promise<CircleX402SettleResult> {
    const idempotencyKey = randomBytes(16).toString('hex');
    // Per Circle Gateway / x402 spec, POST /v1/x402/settle expects:
    //   {
    //     paymentPayload: {
    //       x402Version: 2,
    //       accepted:    <PaymentRequirements>,
    //       payload: {
    //         signature:     '0x' + r||s||v (65-byte hex),
    //         authorization: { from, to, value, validAfter,
    //                          validBefore, nonce }
    //       }
    //     },
    //     paymentRequirements: <PaymentRequirements>
    //   }
    // Reference: https://developers.circle.com/api-reference/gateway/all/settle-x402payment
    //
    // Gateway requires validBefore to be at least 7 days in the future
    // (the 60-second window FacilitatorService.settle enforces is a
    // separate check against our own envelope; the Gateway accepts a
    // wider window). The fan-worker tightens the freshness check; we
    // keep its 50s value here for the chain-side freshness view, and
    // Gateway accepts it on its end because it batches anyway.
    const paymentRequirements = {
      scheme: 'exact',
      network: input.network,
      asset: input.authorization.asset ?? '0x3600000000000000000000000000000000000000',
      amount: input.authorization.value,
      payTo: input.authorization.to,
      maxTimeoutSeconds: 60,
      extra: { name: 'USDC', version: '2' },
    };
    const signature =
      '0x' +
      input.authorization.r.replace(/^0x/, '') +
      input.authorization.s.replace(/^0x/, '') +
      input.authorization.v.toString(16).padStart(2, '0');
    const payload = {
      signature,
      authorization: {
        from: input.authorization.from,
        to: input.authorization.to,
        value: input.authorization.value,
        validAfter: input.authorization.validAfter,
        validBefore: input.authorization.validBefore,
        nonce: input.authorization.nonce,
      },
    };
    const paymentPayload = {
      x402Version: 2,
      accepted: paymentRequirements,
      payload,
      extensions: {},
    };
    const r = await this.request<CircleX402SettleResult>({
      method: 'POST',
      url: `${this.gatewayUrl}/v1/x402/settle`,
      body: { paymentPayload, paymentRequirements },
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
        // EIP-712 typedData carries BigInts (chainId, value, validAfter,
        // validBefore). JSON.stringify throws on BigInt by default —
        // use a recursive replacer that emits them as decimal strings
        // (Circle's API accepts stringified uint256 values).
        body: opts.body
          ? JSON.stringify(opts.body, (_k, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            )
          : undefined,
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
        logger.error(
          {
            method: opts.method,
            url: new URL(opts.url).pathname,
            status: res.status,
            body: text.slice(0, 1000),
          },
          'circle:request_failed',
        );
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
