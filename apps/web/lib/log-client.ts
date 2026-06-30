/**
 * Phase 10 — structured client-side error reporter.
 *
 * Sends the failure payload to /api/log/client-error so the server can
 * join it with the existing pino instance and correlation IDs. Falls
 * back to a console.warn when the network call fails (so we never
 * throw during error handling itself).
 */
export interface ClientErrorPayload {
  surface: string;
  correlationId: string | null;
  error: { name: string; message: string; stack?: string };
  info: { componentStack?: string };
  url?: string;
}

export async function logClientError(payload: ClientErrorPayload): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/log/client-error', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        url: window.location.href,
        userAgent: navigator.userAgent,
        ts: new Date().toISOString(),
      }),
    });
  } catch (err) {
    // Last-resort: never throw from error reporting.
    // eslint-disable-next-line no-console
    console.warn('[pazzera:client-error]', payload.surface, payload.error.message, err);
  }
}
