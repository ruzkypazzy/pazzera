/**
 * Circle Gateway (x402 facilitator) client.
 *
 * Wraps the two endpoints we need:
 *   POST /v1/x402/settle           — submit a signed EIP-3009 TransferWithAuthorization
 *   GET  /v1/x402/transfers/:id    — poll for settlement status
 *
 * See: https://docs.arc.network and https://gateway-api-testnet.circle.com docs.
 *
 * NOTE: The endpoint paths are based on the public Circle Gateway docs. If they
 * change at GA, only this file needs updating.
 */
import { getEnv, BlockchainError } from '@pazzera/core';

export interface SettleRequest {
  /** Signed EIP-3009 TransferWithAuthorization payload (the x402 envelope). */
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: string; // decimal string in USDC base units (6 decimals)
    validAfter: string; // unix seconds
    validBefore: string; // unix seconds
    nonce: `0x${string}`;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  };
  /** Network ID, e.g. "eip155:5042002". */
  network: string;
}

export interface SettleResponse {
  transferId: string;
  status: 'pending' | 'settled' | 'failed';
  txHash?: string;
}

export interface TransferStatus {
  transferId: string;
  status: 'pending' | 'settled' | 'failed';
  txHash?: string;
  error?: string;
}

export class CircleGatewayClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    const env = getEnv();
    this.baseUrl = env.CIRCLE_GATEWAY_FACILITATOR_URL.replace(/\/+$/, '');
    this.apiKey = env.CIRCLE_API_KEY;
  }

  async settle(req: SettleRequest): Promise<SettleResponse> {
    const res = await this.fetch('/v1/x402/settle', {
      method: 'POST',
      body: JSON.stringify(req),
    });
    return res as SettleResponse;
  }

  async getTransfer(transferId: string): Promise<TransferStatus> {
    return (await this.fetch(`/v1/x402/transfers/${encodeURIComponent(transferId)}`, {
      method: 'GET',
    })) as TransferStatus;
  }

  private async fetch(path: string, init: RequestInit): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      throw new BlockchainError('Circle Gateway network error', {
        url,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BlockchainError(
        `Circle Gateway ${res.status}: ${text || res.statusText}`,
        { url, status: res.status },
      );
    }
    return res.json();
  }
}

let cached: CircleGatewayClient | null = null;
export function getCircleGatewayClient(): CircleGatewayClient {
  if (!cached) cached = new CircleGatewayClient();
  return cached;
}