'use client';

/**
 * Phase 10 — root error boundary for the App Router.
 *
 * Triggered when any route's RSC payload throws or when a server action
 * fails synchronously. Logs the failure server-side via the structured
 * logger and offers the user a retry / dashboard escape hatch.
 */
import { useEffect } from 'react';
import { logger } from '@pazzera/core';

interface RootErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: RootErrorProps): JSX.Element {
  useEffect(() => {
    logger.error(
      {
        surface: 'root_error_boundary',
        digest: error.digest,
        message: error.message,
        stack: error.stack,
      },
      'web:root_error',
    );
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
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Retry
        </button>
        <a
          href="/dashboard"
          className="rounded-md border border-border bg-bg-muted px-4 py-2 text-sm font-medium text-fg"
        >
          Dashboard
        </a>
      </div>
    </div>
  );
}
