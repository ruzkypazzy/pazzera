/**
 * Pazzera wallet layer.
 *
 * Public surface:
 *   - WalletProvider interface
 *   - 3 adapters: CircleWalletProvider, LocalDevWalletProvider, ArcNativeWalletProvider
 *   - v2 encryption (versioned, rotatable)
 *   - getWalletProvider() factory
 *   - signAuthorizationFor() / transferFor() helpers (LocalDev only)
 */
export * from './provider';
export * from './encryption';
export * from './local-dev-provider';
export * from './circle-ucw-provider';
export * from './arc-native-provider';
export * from './factory';