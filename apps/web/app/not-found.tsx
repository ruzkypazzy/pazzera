/**
 * Phase 10 — 404 fallback for unknown routes. Strict typed links.
 */
export default function NotFound(): JSX.Element {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold text-fg">We couldn't find that page.</h1>
      <p className="text-sm text-fg-muted">
        The link is stale or the song has been removed. Head back to the dashboard to keep listening.
      </p>
      <div className="mt-2 flex gap-2">
        <a
          href="/dashboard"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Dashboard
        </a>
        <a
          href="/discover"
          className="rounded-md border border-border bg-bg-muted px-4 py-2 text-sm font-medium text-fg"
        >
          Discover
        </a>
      </div>
    </div>
  );
}
