/**
 * CircleWalletProvider — User-Controlled Wallets (UCW) via Circle W3S.
 *
 * This is the PRIMARY provider in production. UCW means the user owns the
 * keys: Circle helps the user provision and recover the wallet, but
 * Pazzera never has the ability to withdraw on the user's behalf.
 *
 * Pazzera's role for nano-payments is OPTION B (delegated spend auth):
 *   1. Frontend obtains a session token from Circle (challenge → OTP).
 *   2. User signs an EIP-712 TransferWithAuthorization in the browser
 *      via Circle's challenge response (PIN / social / device-key).
 *   3. Pazzera submits the signed payload to Circle Gateway facilitator
 *      for settlement.
 *   4. The signature has validBefore ≤ now+60s and a one-time nonce;
 *      Pazzera cannot reuse it for any other payment.
 *
 * This file documents the integration shape and provides the read paths
 * (balance) that work today. The full UCW flow requires the Circle Web
 * SDK on the client + a backend to fetch challenge tokens, which lands
 * in Phase 9 alongside the x402 settlement work.
 *
 * If Circle UCW isn't available during the hackathon (e.g. testnet outage,
 * missing App ID), the LocalDevWalletProvider is the documented fallback
 * — see `ProviderFactory` for the selection logic.
 */
import type { Address } from 'viem';
import {
  baseUnitsToUsdc,
  usdcAddress,
} from '../adapters/usdc';
import { getArcPublicClient } from '../adapters/arc';
import type {
  WalletProvider,
  WalletProvisionInput,
  WalletProvisionResult,
  BalanceResult,
  TransferInput,
  TransferResult,
  SignAuthorizationInput,
  SignAuthorizationResult,
} from './index';

const USDC_BALANCEOF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export class CircleWalletProvider implements WalletProvider {
  readonly name = 'circle-ucw' as const;

  /**
   * Provision a new UCW for the user.
   *
   * Real flow (wired in Phase 9):
   *   1. POST /v1/w3s/user/initialize → userToken
   *   2. POST /v1/w3s/user/rotate → recovery
   *   3. POST /v1/w3s/wallets → walletSetId + accounts[]
   *   4. PATCH /v1/w3s/wallets/:id → set default + name
   *   5. Return accounts[0].address
   *
   * For now we leave the network call structure stubbed and document
   * the shape; Phase 9 fills in the actual REST calls.
   */
  async createWallet(_input: WalletProvisionInput): Promise<WalletProvisionResult> {
    throw new Error(
      'CircleWalletProvider.createWallet: not yet wired. ' +
        'Use LocalDevWalletProvider in dev, or wait for Phase 9 (UCW REST integration).',
    );
  }

  async getBalance(address: string): Promise<BalanceResult> {
    // Balance reads use Arc RPC — the chain doesn't care which provider
    // provisioned the wallet. Circle UCW just gave us the address.
    const client = getArcPublicClient();
    const balance = (await client.readContract({
      address: usdcAddress(),
      abi: USDC_BALANCEOF_ABI,
      functionName: 'balanceOf',
      args: [address as Address],
    } as never)) as bigint;
    const blockNumber = Number(await client.getBlockNumber());
    const balanceBaseUnits = balance.toString();
    return {
      address,
      balanceBaseUnits,
      balanceUsdc: baseUnitsToUsdc(balanceBaseUnits),
      blockNumber,
    };
  }

  async transfer(_input: TransferInput): Promise<TransferResult> {
    // UCW: the user signs client-side. Backend never holds the key.
    // This provider does not perform server-side transfers.
    throw new Error(
      'CircleWalletProvider.transfer: not supported server-side. ' +
        'UCW transfers are signed by the user via the Web SDK and submitted through the x402 facilitator.',
    );
  }

  async signAuthorization(_input: SignAuthorizationInput): Promise<SignAuthorizationResult> {
    throw new Error(
      'CircleWalletProvider.signAuthorization: not supported server-side. ' +
        'User signs in the browser; backend receives the signed envelope via WebSocket.',
    );
  }

  supportsNanoPayments(): boolean {
    return true; // via x402 + user signature
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const client = getArcPublicClient();
      await client.getBlockNumber();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}