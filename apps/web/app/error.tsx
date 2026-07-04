'use client';

/**
 * Phase 12 — root error boundary for the App Router.
 *
 * Client component. Must NOT import from @pazzera/core or any other server-only
 * module — Next.js still tries to bundle those for the client error boundary,
 * and they pull in Node built-ins (child_process, ioredis, etc.) that fail the
 * production build. The previous logger import has been removed; we now POST
 * the error to the server-side log endpoint instead.
 */
import { useEffect } from 'react';

interface RootErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: RootErrorProps): JSX.Element {
  useEffect(() => {
    // Surface the error details to the dev console AND the server log so
    // we can actually diagnose what's throwing — the previous version
    // POSTed a body shape the API endpoint didn't expect, so the actual
    // error info was lost in production logs.
    if (typeof window !== 'undefined') {
      try {
        // eslint-disable-next-line no-console
        console.error('[root_error_boundary]', {
          digest: error.digest,
          message: error.message,
          stack: error.stack,
        });
        fetch('/api/log/client-error', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            surface: 'root_error_boundary',
            correlationId: error.digest ?? null,
            error: {
              name: error.name ?? 'Error',
              message: error.message,
              stack: error.stack ?? null,
            },
            url: window.location.href,
            userAgent: navigator.userAgent,
            ts: new Date().toISOString(),
          }),
        }).catch(() => undefined);
      } catch {
        /* swallow — error boundary must not throw */
      }
    }
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold text-fg">Something broke on the page you opened.</h1>
      <p className="text-sm text-fg-muted">
        We logged the failure with a unique identifier so the team can investigate. You can retry
        the page or head back to a known-good surface.
      </p>
      {error.digest && (
        <p className="text-xs text-fg-muted/70">
          Reference:{' '}
          <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono">{error.digest}</code>
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="btn-primary"
        >
          Retry
        </button>
        <a href="/home" className="btn-secondary">
          Home
        </a>
      </div>
    </div>
  );
}