/**
 * Storage adapter (S3-compatible, used for Cloudflare R2).
 *
 * The interface is provider-agnostic. Today only R2/S3 are implemented.
 * Local provider (filesystem) is for dev/test only — writes to ./tmp/.
 */
import { getEnv } from '@pazzera/core';
export * from './service';
export * from './keys';
export type { StorageService, PutOptions, GetUrlOptions, PresignedPutOptions } from './service';