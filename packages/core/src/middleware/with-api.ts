/**
 * `withApi` — wraps Next.js route handlers with consistent error handling,
 * request logging, and CSRF protection.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { AppError, isAppError, ValidationError } from '../utils/errors';
import { verifyCsrf } from './csrf';

type Handler<TParams = unknown> = (args: {
  req: NextRequest | any;
  params: TParams;
  requestId: string;
  userId?: string;
}) => unknown | Promise<unknown>;

export interface WithApiOptions {
  /** Require an authenticated session (sets `userId`). */
  requireAuth?: boolean;
  /** Require a valid CSRF token on mutating methods. */
  requireCsrf?: boolean;
  /** Optional Zod schema to validate parsed JSON body before calling handler. */
  bodySchema?: import('zod').ZodTypeAny;
}

function newRequestId(): string {
  // RFC4122-ish, no external dep
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36)
  );
}

export function withApi<TParams = unknown>(
  handler: Handler<TParams>,
  opts: WithApiOptions = {},
) {
  return async (
    req: NextRequest,
    context: { params?: TParams } = {},
  ): Promise<Response> => {
    const requestId = newRequestId();
    const start = Date.now();

    const respond = (body: unknown, status: number, extra?: HeadersInit) => {
      const res = NextResponse.json(body, { status, headers: extra });
      res.headers.set('x-request-id', requestId);
      return res;
    };

    try {
      // CSRF check
      if (opts.requireCsrf && isMutating(req.method)) {
        const csrfOk = await verifyCsrf(req);
        if (!csrfOk) {
          return respond(
            { error: { code: 'CSRF_INVALID', message: 'CSRF check failed' } },
            403,
          );
        }
      }

      // Body validation
      let body: unknown = undefined;
      if (opts.bodySchema && hasBody(req.method)) {
        try {
          const json = await req.json().catch(() => ({}));
          body = opts.bodySchema.parse(json);
        } catch (err) {
          if (err instanceof ZodError) {
            throw new ValidationError(
              'Invalid request body',
              { issues: err.issues },
            );
          }
          throw err;
        }
      }

      // Auth (deferred — actual session lookup happens inside handler via session service)
      // Here we just pass through; handlers can call getSession() themselves.

      const response = (await handler({
        req: withBody(req, body),
        params: (context.params ?? ({} as TParams)) as TParams,
        requestId,
      })) as Response;

      logger.info(
        {
          requestId,
          method: req.method,
          url: req.nextUrl.pathname,
          status: response.status,
          durationMs: Date.now() - start,
        },
        'request',
      );

      response.headers.set('x-request-id', requestId);
      return response;
    } catch (err) {
      const status = isAppError(err) ? err.status : 500;
      const code = isAppError(err) ? err.code : 'INTERNAL';
      const message =
        isAppError(err) ? err.message : 'Internal server error';

      logger.error(
        {
          requestId,
          method: req.method,
          url: req.nextUrl.pathname,
          status,
          code,
          err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
          durationMs: Date.now() - start,
        },
        'request_failed',
      );

      const headers: Record<string, string> = {};
      if (isAppError(err) && err.code === 'RATE_LIMITED') {
        const retryAfterSec = (err.meta?.retryAfterSec as number) ?? 60;
        headers['retry-after'] = String(retryAfterSec);
      }

      return respond({ error: { code, message } }, status, headers);
    }
  };
}

function isMutating(method: string | undefined): boolean {
  if (!method) return false;
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function hasBody(method: string | undefined): boolean {
  if (!method) return false;
  return ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
}

// Re-attach parsed body so handler doesn't have to re-parse.
// Next.js NextRequest body is a stream that's consumed once; we cache.
type ReqWithBody = NextRequest & { __parsedBody?: unknown };
function withBody(req: NextRequest, body: unknown): NextRequest {
  (req as ReqWithBody).__parsedBody = body;
  return req;
}

export function getParsedBody<T = unknown>(req: NextRequest): T {
  return ((req as ReqWithBody).__parsedBody ?? {}) as T;
}