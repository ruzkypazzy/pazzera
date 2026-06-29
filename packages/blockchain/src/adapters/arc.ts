/**
 * Arc Testnet RPC adapter.
 *
 * Wraps viem PublicClient + WalletClient with our chain config.
 * All other adapters depend on this for chain reads and tx submission.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Hex,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getEnv, BlockchainError } from '@pazzera/core';

let publicClient: PublicClient | null = null;
let chain: Chain | null = null;

function getChain(): Chain {
  if (chain) return chain;
  const env = getEnv();
  chain = {
    id: env.ARC_CHAIN_ID,
    name: 'Arc Testnet',
    network: 'arc-testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: {
      default: { http: [env.ARC_RPC_URL] },
      public: { http: [env.ARC_RPC_URL] },
    },
    blockExplorers: {
      default: { name: 'ArcScan', url: env.ARC_EXPLORER_URL },
    },
    testnet: true,
  };
  return chain;
}

export function getArcPublicClient(): PublicClient {
  if (publicClient) return publicClient;
  const env = getEnv();
  publicClient = createPublicClient({
    chain: getChain(),
    transport: http(env.ARC_RPC_URL, { retryCount: 3, retryDelay: 500 }),
  });
  return publicClient;
}

/** Create a WalletClient from a raw private key. Caller MUST have decrypted it securely. */
export function getArcWalletClient(privateKey: Hex): WalletClient {
  const env = getEnv();
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: getChain(),
    transport: http(env.ARC_RPC_URL, { retryCount: 3, retryDelay: 500 }),
  });
}

/** Wait for a tx receipt with timeout. */
export async function waitForReceipt(hash: Hex, timeoutMs = 60_000) {
  const client = getArcPublicClient();
  try {
    return await client.waitForTransactionReceipt({ hash, timeout: timeoutMs });
  } catch (err) {
    throw new BlockchainError('Failed to fetch tx receipt', {
      hash,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export type { Account, Hex, PublicClient, WalletClient };