/**
 * ProviderFactory — selects the active wallet provider based on env.
 *
 * Selection logic (in order):
 *   1. PAZZERA_WALLET_PROVIDER env var if set ('circle-ucw' | 'local-dev' | 'arc-native')
 *   2. Default to 'local-dev' in NODE_ENV=development
 *   3. Default to 'circle-ucw' in NODE_ENV=production
 *
 * The factory is process-wide cached so we only construct one provider
 * per process. Tests can call `__resetProviderForTests()` to swap.
 */
import { LocalDevWalletProvider } from './local-dev-provider';
import { CircleWalletProvider } from './circle-ucw-provider';
import { ArcNativeWalletProvider } from './arc-native-provider';
import type { WalletProvider } from './index';

let cached: WalletProvider | null = null;

function selectFromEnv(): WalletProvider {
  const explicit = process.env.PAZZERA_WALLET_PROVIDER?.trim();
  if (explicit === 'local-dev') return new LocalDevWalletProvider();
  if (explicit === 'circle-ucw') return new CircleWalletProvider();
  if (explicit === 'arc-native') return new ArcNativeWalletProvider();
  if (process.env.NODE_ENV === 'production') return new CircleWalletProvider();
  return new LocalDevWalletProvider();
}

export function getWalletProvider(): WalletProvider {
  if (cached) return cached;
  cached = selectFromEnv();
  return cached;
}

export function __resetProviderForTests(): void {
  cached = null;
}

export function setWalletProviderForTest(provider: WalletProvider): void {
  cached = provider;
}