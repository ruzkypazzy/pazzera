/**
 * ArcNativeWalletProvider — PLACEHOLDER.
 *
 * Reserved for a future Arc-native wallet API (e.g. an account-abstraction
 * primitive shipped by Arc that Pazzera could use as an alternative to
 * Circle UCW). Today this is a thin shim that surfaces a clear "not
 * implemented" error so callers don't accidentally fall through to a
 * default. Wired into ProviderFactory so it's a one-line swap when ready.
 */
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

export class ArcNativeWalletProvider implements WalletProvider {
  readonly name = 'arc-native' as const;

  async createWallet(_input: WalletProvisionInput): Promise<WalletProvisionResult> {
    throw new Error('ArcNativeWalletProvider: not yet implemented. Use CircleWalletProvider or LocalDevWalletProvider.');
  }
  async getBalance(_address: string): Promise<BalanceResult> {
    throw new Error('ArcNativeWalletProvider: not yet implemented.');
  }
  async transfer(_input: TransferInput): Promise<TransferResult> {
    throw new Error('ArcNativeWalletProvider: not yet implemented.');
  }
  async signAuthorization(_input: SignAuthorizationInput): Promise<SignAuthorizationResult> {
    throw new Error('ArcNativeWalletProvider: not yet implemented.');
  }
  supportsNanoPayments(): boolean {
    return false;
  }
}