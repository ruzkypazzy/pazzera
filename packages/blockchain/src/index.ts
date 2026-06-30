/**
 * Blockchain adapter package.
 *
 * Note on barrel exports: a few names are intentionally re-exported from
 * only one of their duplicates so that callers get a single canonical
 * implementation:
 *   - `TransferWithAuthorization`, `EIP712_TYPES`, `getEip712Domain`
 *     come from `./x402/typed-data` (not the legacy `./services/eip712`,
 *     which is kept only for the local-dev provider).
 *   - `encryptPrivateKey`, `decryptPrivateKey` come from `./wallets/encryption`
 *     (v2). The legacy `./services/wallet-signer` is re-exported under the
 *     `v1` namespace for the migration path.
 */
export * from './adapters/arc';
export * from './adapters/circle-gateway';
export * from './adapters/usdc';

export {
  encryptPrivateKeyV2,
  decryptPrivateKeyV2,
  serializeBlob,
  parseBlob,
  migrateToV2,
  decryptAndMigrate,
  generateWalletKeypairV2,
  type PazzeraWalletBlobV2,
} from './wallets/encryption';

export * as v1Sign from './services/wallet-signer';
export {
  signAuthorization as signAuthorizationV1,
  recoverAuthorizationSigner,
  hashAuthorization,
  newNonce as newNonceV1,
  newNonce,
} from './services/eip712';

export * from './services/wallet-service';
export * from './services/wallet-recovery';
export * from './services/facilitator-service';
export * from './wallets';
export * from './circle';
export * from './x402';
