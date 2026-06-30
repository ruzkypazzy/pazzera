'use client';

/**
 * Phase 10 — production-grade ErrorBoundary.
 *
 * - Catches render-time exceptions anywhere inside its subtree
 * - Logs the failure with a correlation ID via the structured logger
 * - Offers the user one of: retry, navigate-home, or open-the-issue
 *
 * Strict typing preserved: every prop is a primitive or a typed
 * ReactNode; no `any` leaks.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logClientError } from '@/lib/log-client';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** Logical surface — used to label logs and the UI copy. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  correlationId: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, correlationId: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, correlationId: `err_${Math.random().toString(36).slice(2, 12)}` };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    void logClientError({
      surface: this.props.label ?? 'unknown',
      correlationId: this.state.correlationId,
      error: { name: error.name, message: error.message, stack: error.stack },
      info: { componentStack: info.componentStack ?? '' },
    }).catch(() => undefined);
  }

  retry = (): void => {
    this.setState({ error: null, correlationId: null });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback(this.state.error, this.retry);
    }
    return (
      <div className="mx-auto max-w-2xl px-4 py-12" role="alert" aria-live="polite">
        <h2 className="text-xl font-semibold text-fg">Something went wrong.</h2>
        <p className="mt-3 text-sm text-fg-muted">
          We hit an unexpected error rendering this page. You can retry, or jump back to the dashboard.
        </p>
        <p className="mt-2 text-xs text-fg-muted/70">
          Reference:{' '}
          <code className="rounded bg-bg-muted px-1.5 py-0.5">{this.state.correlationId}</code>
        </p>
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={this.retry}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Retry
          </button>
          <a
            href="/dashboard"
            className="rounded-md border border-border bg-bg-muted px-4 py-2 text-sm font-medium text-fg"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }
}
