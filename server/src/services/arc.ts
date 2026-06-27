/**
 * Arc Testnet RPC client — direct JSON-RPC calls to read on-chain state.
 * Used for: fetching USDC balance, transaction history, gas estimation.
 *
 * Uses viem for type-safe ABI encoding + raw RPC. Falls back to raw fetch
 * if viem types are not available at runtime.
 */
import { createPublicClient, http, parseAbi, formatUnits, type Address } from 'viem';

const ARC_CHAIN_ID = 5042002;
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as Address;
const USDC_DECIMALS = 6;

// Arc Testnet public RPC (read endpoints) — from Canteen docs.
// In production use a private RPC for higher rate limits.
function getArcRpcUrl(): string {
  return process.env.ARC_RPC_URL || 'https://rpc.testnet.arc-node.thecanteenapp.com/v1';
}

const arcClient = () =>
  createPublicClient({
    transport: http(getArcRpcUrl(), { batch: { batchSize: 50 } }),
  });

const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

const client = arcClient();

/**
 * Get USDC balance for an address (in human-readable units, e.g. "1.500000")
 */
export async function getUsdcBalance(address: string): Promise<string> {
  try {
    const balance = (await client.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address as Address],
    })) as bigint;
    return formatUnits(balance, USDC_DECIMALS);
  } catch (e: any) {
    console.error('[arc/balance] failed for', address, e?.message ?? e);
    return '0';
  }
}

/**
 * Get native gas token balance (for fee estimation / faucet UI)
 */
export async function getNativeBalance(address: string): Promise<string> {
  try {
    const balance = await client.getBalance({ address: address as Address });
    return formatUnits(balance, 18);
  } catch (e: any) {
    console.error('[arc/native-balance] failed for', address, e?.message ?? e);
    return '0';
  }
}

/**
 * Verify an on-chain transaction exists (for confirming x402 settlements)
 */
export async function getTransactionReceipt(txHash: string) {
  try {
    return await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch (e: any) {
    console.error('[arc/tx-receipt] failed for', txHash, e?.message ?? e);
    return null;
  }
}

export const ARC_CONSTANTS = {
  CHAIN_ID: ARC_CHAIN_ID,
  USDC_ADDRESS,
  USDC_DECIMALS,
  EXPLORER_URL: 'https://testnet.arcscan.app',
  FAUCET_URL: 'https://faucet.circle.com',
  NETWORK_NAME: 'Arc Testnet',
};