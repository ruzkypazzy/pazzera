/**
 * LocalDevWalletProvider — for local dev / hackathon demo when Circle UCW
 * isn't available. Generates a real secp256k1 keypair, encrypts the private
 * key with AES-256-GCM v2 (versioned), and stores the encrypted blob on
 * the Wallet row.
 *
 * Custody mode: 'platform'. The encrypted key IS stored server-side, so
 * Pazzera can sign on behalf of the user. Use this ONLY for local dev or
 * an explicitly enabled "demo mode" toggle. In production, the
 * CircleWalletProvider (UCW) is the default and the platform never holds keys.
 */
import { type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getArcPublicClient,
  getArcWalletClient,
  waitForReceipt,
  encodeTransfer,
  baseUnitsToUsdc,
  usdcAddress,
} from '../adapters/usdc';
import { signAuthorization as coreSignAuthorization } from '../services/eip712';
import {
  generateWalletKeypairV2,
  encryptPrivateKey,
  decryptPrivateKey,
  parseBlob,
  fingerprintAddress,
  type WalletProvider,
  type WalletProvisionInput,
  type WalletProvisionResult,
  type BalanceResult,
  type TransferInput,
  type TransferResult,
  type SignAuthorizationInput,
  type SignAuthorizationResult,
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

export class LocalDevWalletProvider implements WalletProvider {
  readonly name = 'local-dev' as const;

  async createWallet(input: WalletProvisionInput): Promise<WalletProvisionResult> {
    const { privateKey, address } = generateWalletKeypairV2();
    const encrypted = encryptPrivateKey(input.userId, privateKey);
    return {
      providerWalletId: `local-${input.userId}-${Date.now()}`,
      address,
      custody: 'platform', // documented demo mode
      encryptedSecret: encrypted,
      providerMeta: { keyVersion: 1, encryptionVersion: 2, addressFingerprint: fingerprintAddress(address) },
    };
  }

  async getBalance(address: string): Promise<BalanceResult> {
    const client = getArcPublicClient();
    const balance = (await client.readContract({
      address: usdcAddress(),
      abi: USDC_BALANCEOF_ABI,
      functionName: 'balanceOf',
      args: [address as Address],
    })) as bigint;
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
    // Direct transfer not supported on this provider — the high-level
    // WalletService handles decryption + signing. See transferFor() below.
    throw new Error('Use WalletService.transfer() with the encryptedSecret on the Wallet row.');
  }

  async signAuthorization(_input: SignAuthorizationInput): Promise<SignAuthorizationResult> {
    // Same as above — actual signing happens in the high-level service.
    return {
      v: 0,
      r: '0x' as `0x${string}`,
      s: '0x' as `0x${string}`,
      platformSigned: false,
    };
  }

  supportsNanoPayments(): boolean {
    return true; // demo: yes, we sign on the user's behalf
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

// ─── Service-layer helpers (used by Fan/Split workers + transfer API) ─

/**
 * Sign an EIP-712 authorization for x402 using a stored encrypted key.
 * Returns a v/r/s tuple. Caller submits to Circle Gateway.
 */
export async function signAuthorizationFor(
  userId: string,
  encryptedSecret: string,
  input: Omit<SignAuthorizationInput, 'walletAddress'>,
): Promise<SignAuthorizationResult> {
  // Lazy-migrate v1 → v2 if needed
  const { decryptAndMigrate } = await import('./encryption');
  const { key: privateKey, migratedJson } = decryptAndMigrate(userId, encryptedSecret);
  // Persist migrated blob if it changed (best effort; ignore if wallet row gone)
  if (migratedJson !== encryptedSecret) {
    try {
      const { prisma } = await import('@pazzera/db');
      await prisma.wallet.updateMany({
        where: { userId },
        data: { encryptedPrivateKey: migratedJson },
      });
    } catch {
      // no-op
    }
  }
  const account = deriveAccountFromKey(privateKey);
  const core = coreSignAuthorization(privateKey, {
    from: account.address,
    to: input.to as Address,
    value: input.valueBaseUnits,
    validAfter: String(input.validAfter),
    validBefore: String(input.validBefore),
    nonce: input.nonce,
  });
  return { v: core.v, r: core.r, s: core.s, platformSigned: true };
}

/** Submit a USDC transfer using a stored encrypted key. */
export async function transferFor(
  userId: string,
  encryptedSecret: string,
  input: TransferInput,
): Promise<TransferResult> {
  if (!input.submit) {
    throw new Error('LocalDevWalletProvider only supports submit=true');
  }
  const { decryptAndMigrate } = await import('./encryption');
  const { key: privateKey, migratedJson } = decryptAndMigrate(userId, encryptedSecret);
  if (migratedJson !== encryptedSecret) {
    try {
      const { prisma } = await import('@pazzera/db');
      await prisma.wallet.updateMany({
        where: { userId },
        data: { encryptedPrivateKey: migratedJson },
      });
    } catch {
      // no-op
    }
  }
  const walletClient = getArcWalletClient(privateKey);
  const txHash = await walletClient.sendTransaction({
    to: usdcAddress(),
    data: encodeTransfer(input.toAddress as Address, BigInt(input.amountBaseUnits)),
  });
  const receipt = await waitForReceipt(txHash);
  return {
    txHash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    status: receipt.status === 'success' ? 'confirmed' : 'failed',
    platformSigned: true,
  };
}

function deriveAccountFromKey(privateKey: Hex) {
  return privateKeyToAccount(privateKey);
}

// Helper re-export so callers can pin the blob's key/salt versions
export { parseBlob };