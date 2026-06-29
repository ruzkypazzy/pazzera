/**
 * Typed application error hierarchy.
 *
 * The `withApi` wrapper in `packages/core/src/middleware/with-api.ts`
 * inspects `instanceof AppError` to map errors to HTTP responses with
 * stable codes for the frontend.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'AUTH_RATE_LIMITED'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_INSUFFICIENT_BALANCE'
  | 'PAYMENT_ALREADY_SETTLED'
  | 'RATE_LIMITED'
  | 'STORAGE_ERROR'
  | 'BLOCKCHAIN_ERROR'
  | 'INTERNAL';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly meta?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, meta);
    this.name = 'ValidationError';
  }
}

export class AuthError extends AppError {
  constructor(code: ErrorCode = 'AUTH_REQUIRED', message = 'Authentication required') {
    super(code, message, code === 'AUTH_REQUIRED' ? 401 : 401);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('CONFLICT', message, 409, meta);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSec: number) {
    super('RATE_LIMITED', 'Rate limit exceeded', 429, { retryAfterSec });
    this.name = 'RateLimitError';
  }
}

export class PaymentError extends AppError {
  constructor(code: ErrorCode, message: string, meta?: Record<string, unknown>) {
    super(code, message, 402, meta);
    this.name = 'PaymentError';
  }
}

export class StorageError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('STORAGE_ERROR', message, 502, meta);
    this.name = 'StorageError';
  }
}

export class BlockchainError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('BLOCKCHAIN_ERROR', message, 502, meta);
    this.name = 'BlockchainError';
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}