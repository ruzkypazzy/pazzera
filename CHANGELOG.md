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

## Phase 11 — AI Upload Agent ("PAZZERA BOT")

### Added
- **`/upload` page** — completely redesigned. Title now reads
  "PAZZERA BOT" with a `v1` badge. Renders only the conversational
  AI Agent (no manual form). Manual form preserved in the artist
  dashboard for users who navigate there directly.
- **`AgentChat` component** (`apps/web/components/agent/AgentChat.tsx`)
  — chat panel UI with drag-and-drop, Cmd/Ctrl+Enter shortcut,
  smart auto-scroll, rate preset chips, success card
  ("Submitted to Curator ✓"), inline error with retry button.
- **AI upload agent backend** (`packages/agents/src/upload-agent/`):
  - `llm.ts` — OpenAI wrapper with `chat()` (JSON mode),
    `chatVision()` (cover art), `chatText()` (free-form chat),
    `llmHealth()`.
  - `analyze.ts` — `music-metadata` + energy/mood heuristics.
  - `decide.ts` — `gpt-4o-mini` JSON-mode decision with
    rate clamp [0.001, 0.005] USDC. **Never rejects.**
  - `router.ts` — state machine with cases for text/audio/cover/
    rate/recipient_username/recipient_pct/commit/reset. Fuzzy
    "did you mean?" search when recipient not exact match.
- **Agent API routes**:
  - `POST/GET /api/agent/upload/message` — multipart (audio/cover)
    + JSON chat input.
  - `POST /api/agent/upload/commit` — drives the LOCKED pipeline
    (`create-draft` → multipart `upload/audio` + `upload/cover` →
    `upload/finalize`), resolves Pazzera usernames via Prisma,
    skips empty/0% recipients.
  - `GET /api/agent/upload/stage/[...key]` — auth-gated file reader.
- **`AgentUploadSession` Prisma model** (additive only) — stores
  state machine + messages JSON for the agent session.
- **Worker container fix** (`docker/Dockerfile.worker` +
  `docker-compose.yml`) — switched to Debian + libssl3 for Prisma,
  added `@pazzera/realtime` + `@pazzera/upload` package.json copies,
  fixed `command` to run via `tsx`, mounted the local storage
  volume so the worker can read audio/cover files written by web.
- **Build-time fixes** in `docker/Dockerfile.web`:
  - Removed invalid `COPY .env* .env 2>/dev/null || true` syntax.
  - Fixed `USER pazzera` ordering so `mkdir /app/data/agent-stage`
    runs as root.
  - `chmod 777 /tmp/pazzera-uploads` for STORAGE_PROVIDER=local
    compatibility (the pazzera user otherwise can't write).
- **`README.md`** — comprehensive rewrite including the new
  PAZZERA BOT section, full env var table, architecture diagram,
  agent pipeline diagram, deployment runbook, license section.
- **`LICENSE`** — MIT.
- **Test scripts** (`packages/agents/scripts/`):
  - `test-upload-agent.ts` — end-to-end analyze + caption + decide.
  - `test-agent-session.ts` — Prisma CRUD smoke test.
- **`upload-dialog.tsx`** — dropped the `[AI Agent | Manual]` tab
  strip + the entire manual form code. Dialog now renders only
  the AI Agent.

### Fixed
- **PlayBar playback gate** — added reactive `useEffect` that
  re-checks the gate whenever `storeIsPlaying` flips, catching
  bypass paths in the bottom PlayerBar play button and auto-play
  effects. (`apps/web/components/shell/PlayerBar.tsx`)
- **Top-up Circle Gateway balance 504** — route now returns 200
  with `status:'pending'` on poll 404 instead of throwing. The
  facilitator's indexer window accepts pending state.
- **Homepage copy** — refreshed subhead with the user's framing
  about USDC per stream, no platform fees, on Arc via x402.
- **Realtime platform stats on /home** — `/api/stats/platform`
  (public, 5s cache) + `PlatformStats.tsx` polling every 15s.
- **`prisma.payment.groupBy` `_sum`** — `amountUsdc` is a String,
  so `groupBy({_sum: ...})` fails. Use `findMany` + JS `reduce`
  instead.
- **ShellUserContext.tsx** removed permanently (had been deleted
  in an earlier session but kept creeping back). Replaced by
  per-page `SessionBootstrap` (zustand).
- **Page copy on `/home`** — got `EffectiveBalance` null check.
- **`/api/songs/create-draft` response shape** — returns `id`, not
  `songId`. Commit route now reads `draftJson.songId ?? draftJson.id`.
- **`/api/upload/finalize` payload shape** — requires nested
  `metadata` block + resolved internal recipients with
  `displayName`. Commit route builds the full payload.
- **Audio/cover upload permission** — `STORAGE_PROVIDER=local`
  requires `/tmp/pazzera-uploads` to be writable by the pazzera
  user. Dockerfile.web chmods it on every build.
- **Audio/cover presigned URL** — local provider returns
  `/api/dev/upload?key=...&token=...` which 401s because the route
  doesn't exist. Commit route now uses multipart instead.

### Removed
- **`upload-dialog.tsx` manual form** — duplicated by the AI Agent.
  Manual form preserved in the LOCKED artist dashboard for direct
  navigation.
- **`apps/web/postcss.config.js`** — renamed to `.cjs` in an earlier
  session; the `.js` deletion matches reality.
