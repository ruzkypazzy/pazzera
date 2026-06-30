/**
 * Phase 10 — root-level Suspense fallback for the App Router.
 */
export default function Loading(): JSX.Element {
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center gap-3 px-4 py-16 text-sm text-fg-muted">
      <span className="h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      Loading Pazzera…
    </div>
  );
}
