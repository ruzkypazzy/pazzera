# Changelog

All notable changes to **Pazzera** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0).

## [Unreleased] — Phase 10

### Added
- **Playwright e2e suite** (`apps/web/tests/e2e/` + `playwright.config.ts`)
  covering marketing landing, email-OTP signin, dashboard rendering,
  song discovery, threshold cross → `payment_due` toast, full
  `payment_authorized → payment_settled` round trip, and admin
  dashboard verification — 8 specs.
- **Test bridges** (`/api/auth/test-otp`, `/api/auth/test-promote`,
  `/api/realtime/test-skip`, `/api/realtime/test-stream-start`,
  `/api/payments/recent`, `/api/log/client-error`, `/ready`) all
  gated by `PAZZERA_TEST_API_ENABLED=true` and disabled in
  `NODE_ENV=production`.
- `apps/web/components/error-boundary.tsx` — typed `ErrorBoundary` with
  retry / dashboard navigation fallback and correlation-ID tagging.
- `apps/web/app/error.tsx`, `app/not-found.tsx`, `app/loading.tsx` — root
  App Router fallback UI surfaces.
- `apps/web/lib/retry.ts` — exponential backoff with full jitter,
  typed `RetryOptions`, `AbortSignal` cancellation.
- `apps/web/lib/realtime-client.ts` — production-grade retry loop
  instead of `socket.io` internal reconnect; explicit `ConnectionStatus`
  enum (`idle / connecting / connected / reconnecting / disconnected /
  failed`); `data-connection-status` body attribute for the e2e suite.
- `apps/web/components/realtime/connection-status.tsx` — visible badge
  for the listener's connection state.
- `apps/web/components/player/sticky-player.tsx` — `pb-[env(safe-area-inset-bottom)]`,
  mobile-first control width (`w-64 hidden sm:flex`), `data-testid`
  markers on `payment-due-toast` + `payment-settled-toast`, queue
  drawer sliding from the bottom on mobile.
- `apps/web/components/player/waveform-progress.tsx` — hover timecode
  tooltip with `formatTimecode` helper.
- `apps/web/lib/log-client.ts` + `apps/web/app/api/log/client-error/route.ts` —
  client-side error reporter that joins server-side correlation IDs.
- **Structured logging**: `setBindings({ requestId })` in
  `withApi` middleware; `x-request-id`/`x-correlation-id` honors upstream
  headers; `apps/web/components/admin/admin-dashboard.tsx`
  receives `data-testid="overview-card|streaming-health-card|agent-health-card"`.
- **Documentation**: `README.md`, `docs/ARCHITECTURE.md`
  (Mermaid), `docs/DEPLOYMENT.md` (runbook), `docs/nginx-pazzera.com.conf`,
  `.env.example`.

### Schema
- Added nullable `debugCode` field to `OtpCode` (only populated when
  `PAZZERA_TEST_API_ENABLED=true`); never returned in production.

## Phase 9 — settlement
- Real Circle UCW settlement: provider abstraction, x402
  typed-data / sign / verify, facilitator service, Circle webhook
  ingestion, wallet:reconcile worker, payments-health admin,
  Settlement Timeline UI.
- Added 23 deterministic tests. Repo total: **75 tests**.

## Phase 8 — realtime
- Socket.IO server + Redis nonces + server-authoritative aggregator +
  payment_due / payment_settled events + player queue + waveform
  progress bar with payment marker + streaming-health admin + demo
  simulator.
- 14 deterministic tests. Repo total: **52 tests**.

## Phase 7 — agents
- 5 agents (Curator v3, Fan v2, Split v2, Discovery, Fraud Sentinel)
  with explainability + 4 fraud detectors + decision-recording with
  deterministic `inputHash` deduplication.
- 38 deterministic tests. Repo total: **38 tests**.

## Earlier phases
- Phase 1-6: monorepo scaffold, repositories, auth + Argon2id OTP
  + sessions + CSRF + wallet providers + upload pipeline (audio /
  waveform / preview / cover workers, fingerprinting, LUFS).
- Initial TypeScript + Prisma + Vitest + Playwright setup.
