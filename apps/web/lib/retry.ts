/**
 * Phase 10 — retry-with-jitter helper used by the realtime client and
 * any network-sensitive fetch path. Strict typing preserved.
 *
 *   await retry(() => fetch(url), { attempts: 5, baseDelayMs: 250 });
 */
export interface RetryOptions {
  /** Maximum attempts (>= 1). Default 5. */
  attempts?: number;
  /** Initial delay, ms. Default 250. */
  baseDelayMs?: number;
  /** Max delay per retry, ms. Default 8_000. */
  maxDelayMs?: number;
  /** Network errors only by default; pass a predicate to opt into 5xx. */
  shouldRetry?: (err: unknown) => boolean;
  /** AbortSignal for cancelling mid-backoff. */
  signal?: AbortSignal;
}

const defaultShouldRetry = (err: unknown): boolean => {
  if (!err) return false;
  // Don't retry programmer errors; do retry transport / network.
  return err instanceof TypeError || /failed/i.test(String((err as Error).message ?? ''));
};

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 5);
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const maxDelayMs = opts.maxDelayMs ?? 8_000;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i === attempts - 1 || !shouldRetry(err)) throw err;
      // exponential with full jitter
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** i);
      const wait = Math.floor(Math.random() * backoff);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, wait);
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
  }
  // Unreachable — last iteration always either returns or throws — but TS wants a return.
  throw lastError;
}
