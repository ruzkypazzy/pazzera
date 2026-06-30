export * from './config/env';
export * from './types/domain';
export * from './utils/errors';
export * from './utils/logger';
export * from './utils/password-hash';
export * from './utils/username';
export * from './middleware/rate-limit';
export * from './middleware/with-api';
export * from './middleware/csrf';
export * from './middleware/ip-hash';
export * from './middleware/require-session';
export * from './services/otp-service';
export * from './services/session-service';
export * from './services/email-service';
export * from './services/auth-events';
// Re-export Prisma client + repositories so route handlers can import
// them through @pazzera/core (the canonical place for shared infra).
export { prisma, type Prisma } from '@pazzera/db';
export * from '@pazzera/db/repositories';
// Re-export the storage service so route handlers don't need to know
// about @pazzera/storage's internals.
export { getStorageService, type StorageService } from '@pazzera/storage';
// Re-export queue helpers (enqueue + workers) so route handlers can
// push background jobs without importing @pazzera/queue directly.
export { enqueue, QUEUE_NAMES, type QueueName } from '@pazzera/queue';
// Note: upload pipeline is in @pazzera/upload. UI/handlers import from there directly.