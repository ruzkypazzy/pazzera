# Pazzera — System Architecture

> Decentralized pay-per-listen music streaming on Arc Testnet with USDC nano payments.

**Version**: 1.0 (Phase 1)
**Deployment shape**: Monolith on a single Contabo VPS (Docker + Nginx + PM2)
**Scaling posture**: Designed for horizontal extraction — agents, blockchain adapters, and realtime gateway can be split out as microservices later without changing domain code.

---

## 1. High-Level Architecture

```
                                ┌─────────────────────────────────────────┐
                                │            Cloudflare (DNS + CDN)       │
                                │      pazzera.com  →  VPS public IP      │
                                │      R2 custom domain (assets)          │
                                └────────────┬────────────────────────────┘
                                             │
                              HTTPS (TLS via Let's Encrypt)
                                             │
                                ┌────────────▼────────────────────────────┐
                                │              Nginx (reverse proxy)      │
                                │   /api/*  /socket.io/*  →  app:3000     │
                                │   /_next/static/* → app:3000            │
                                │   /assets/*        → app:3000           │
                                └────────────┬────────────────────────────┘
                                             │
                                ┌────────────▼────────────────────────────┐
                                │      Next.js (apps/web) — Node 20       │
                                │ ┌────────────────────────────────────┐  │
                                │ │  App Router (UI)                    │  │
                                │ │  Route Handlers (/api/*)            │  │
                                │ │  Custom Socket.IO server (3001)     │  │
                                │ │  Background workers (BullMQ)        │  │
                                │ └────────────────────────────────────┘  │
                                └─┬──────────┬──────────────┬─────────────┘
                                  │          │              │
                ┌─────────────────┘          │              └──────────────────┐
                │                            │                                 │
   ┌────────────▼──────────┐    ┌────────────▼──────────┐    ┌─────────────────▼────┐
   │  PostgreSQL 16        │    │  Redis 7              │    │  Cloudflare R2        │
   │  (Docker, persistent  │    │  BullMQ queues,       │    │  Audio + covers       │
   │   volume + backup)    │    │  Socket.IO adapter,   │    │  (S3-compatible)      │
   │                       │    │  rate-limit cache     │    │                       │
   └───────────────────────┘    └───────────────────────┘    └───────────────────────┘

                  External services (only over HTTPS / WSS)
   ┌──────────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐
   │  Resend (OTP email)  │  │  Arc Testnet RPC     │  │  Circle Gateway        │
   │  resend.com          │  │  + USDC contract     │  │  x402 facilitator      │
   └──────────────────────┘  └──────────────────────┘  └────────────────────────┘
```

### Why this shape

- **One repo, one deploy.** Faster iteration, fewer moving parts at 1 vCPU / 4 GB Contabo tier.
- **Process boundaries inside one container.** Next.js handles HTTP, Socket.IO runs on a separate port (3001) fronted by Nginx, and BullMQ workers run as `node` scripts under PM2 — same image, different processes. Each can be split into its own container without touching domain code.
- **R2 for blobs.** Audio (mp3/wav/m4a) and cover art (jpg/png/webp) live in R2 with public-read via custom domain. We never write user uploads to the VPS disk except a temp chunk during multipart upload.

---

## 2. Module Boundaries (inside `packages/*`)

| Package | Responsibility | Public surface | May be extracted as |
|---|---|---|---|
| `packages/core` | Config, env validation, shared types, error classes, Zod schemas, JWT/session helpers, logger, rate-limiter | `core/config`, `core/types`, `core/utils`, `core/middleware` | Shared library (npm package) |
| `packages/db` | Prisma schema, generated client, migration runner, seed scripts, repository functions | `db/client`, `db/repositories/*` | Stays inside app (no extraction needed) |
| `packages/storage` | S3-compatible object storage adapter (R2), presigned upload URL generator, public URL builder | `storage.putObject`, `storage.getSignedUrl`, `storage.getPublicUrl` | Standalone microservice (if we move to multi-region) |
| `packages/blockchain` | Arc RPC adapter, Circle Gateway adapter, x402 facilitator client, USDC contract wrapper, EIP-712 helpers, wallet signer wrapper | `blockchain.arc.*`, `blockchain.circle.*`, `blockchain.x402.*`, `blockchain.usdc.*` | Standalone microservice (`pazzera-chain-svc`) |
| `packages/agents` | Curator, Fan, Split agent logic + job handlers. Pure decision-making; no DB or network outside injected adapters | `agents.runCurator()`, `agents.runFan()`, `agents.runSplit()` + BullMQ handlers | Standalone worker fleet |
| `packages/queue` | BullMQ queue factories, Redis connection, job schemas, retry/backoff policies | `queue.queues.*`, `queue.enqueue.*` | Shared lib (or stay inside app) |
| `packages/realtime` | Socket.IO server factory, typed event schemas, presence/room helpers, server-authoritative playback session manager | `realtime.createServer()`, `realtime.events.*` | Separate Socket.IO gateway container |

**Dependency rule (enforced by ESLint `no-restricted-imports`):**
- `core` imports nothing else inside `packages/`.
- `db` may import `core/types` only.
- `storage` may import `core/config`, `core/types`.
- `blockchain` may import `core`, `storage`.
- `agents` may import `core`, `db/repositories`, `blockchain` (read-only via repositories).
- `queue` may import `core`.
- `realtime` may import `core`, `db/repositories`.
- `apps/web` imports everything; nothing imports `apps/web`.

This makes the next refactor — splitting a package out — purely operational, not a code rewrite.

---

## 3. Repository / Folder Layout

```
pazzera/
├── apps/
│   └── web/                              # Next.js 14 App Router
│       ├── app/
│       │   ├── (marketing)/              # Landing page
│       │   │   └── page.tsx
│       │   ├── (auth)/                   # Sign in, OTP verification
│       │   │   ├── sign-in/page.tsx
│       │   │   └── verify/page.tsx
│       │   ├── (app)/                    # Authenticated shell
│       │   │   ├── layout.tsx            # Sticky player + navbar
│       │   │   ├── dashboard/page.tsx    # Listener dashboard
│       │   │   ├── library/page.tsx
│       │   │   ├── search/page.tsx
│       │   │   ├── artist/
│       │   │   │   ├── page.tsx          # Artist dashboard
│       │   │   │   ├── onboarding/page.tsx  # Become an Artist
│       │   │   │   └── upload/page.tsx   # Upload modal host
│       │   │   ├── song/[id]/page.tsx
│       │   │   ├── wallet/page.tsx
│       │   │   └── profile/page.tsx
│       │   ├── (admin)/
│       │   │   └── admin/
│       │   │       ├── page.tsx          # Monitoring overview
│       │   │       ├── agents/page.tsx   # Agent logs
│       │   │       ├── payments/page.tsx # Payment ledger
│       │   │       └── users/page.tsx
│       │   └── api/                      # Route handlers (REST)
│       │       ├── auth/
│       │       │   ├── request-otp/route.ts
│       │       │   ├── verify-otp/route.ts
│       │       │   ├── logout/route.ts
│       │       │   └── session/route.ts
│       │       ├── wallet/
│       │       │   ├── balance/route.ts
│       │       │   ├── deposit/route.ts
│       │       │   ├── withdraw/route.ts
│       │       │   └── transactions/route.ts
│       │       ├── songs/
│       │       │   ├── upload-url/route.ts
│       │       │   ├── finalize/route.ts
│       │       │   ├── [id]/route.ts
│       │       │   └── stream-url/route.ts
│       │       ├── streams/
│       │       │   ├── start/route.ts
│       │       │   ├── heartbeat/route.ts
│       │       │   └── complete/route.ts
│       │       ├── agents/
│       │       │   └── logs/route.ts
│       │       └── webhooks/
│       │           └── resend/route.ts
│       ├── components/
│       │   ├── ui/                       # shadcn/ui primitives
│       │   ├── player/                   # Sticky player footer + waveform
│       │   ├── song/                     # Cards, rows, table
│       │   ├── wallet/                   # Balance card, tx list
│       │   └── upload/                   # Upload modal + dropzone
│       ├── lib/                          # Client utilities (fetch, hooks)
│       ├── server/                       # Server-only modules
│       │   ├── socket-server.ts          # Socket.IO bootstrap (port 3001)
│       │   ├── workers.ts                # BullMQ worker bootstrap
│       │   └── runtime.ts                # Process orchestration
│       ├── tests/                        # Playwright e2e
│       ├── middleware.ts                 # Edge middleware: auth guard, CSP
│       └── next.config.mjs
├── packages/
│   ├── core/                             # see section 2
│   ├── db/                               # Prisma schema + repositories
│   ├── storage/                          # R2 adapter
│   ├── blockchain/                       # Arc + Circle + x402 + USDC
│   ├── agents/                           # Curator, Fan, Split
│   ├── queue/                            # BullMQ queues
│   └── realtime/                         # Socket.IO server + types
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.worker
│   ├── nginx.conf
│   ├── postgres.conf
│   └── redis.conf
├── scripts/
│   ├── backup-postgres.sh
│   ├── restore-postgres.sh
│   └── healthcheck.sh
├── .github/
│   └── workflows/
│       ├── ci.yml                        # lint + typecheck + test + build
│       └── deploy.yml                    # SSH + docker compose pull/up
├── docker-compose.yml                    # web, worker, postgres, redis, nginx
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .env.example
├── .eslintrc.cjs
├── .prettierrc
└── README.md
```

### Why pnpm workspaces

- Shared TS config + ESLint + Prettier at the root.
- One `pnpm install` resolves all packages.
- Hot-path packages (`db`, `blockchain`, `agents`) can be developed and type-checked in isolation.

---

## 4. Streaming + Payment Event Flow

This is the most important lifecycle in the product. The client never decides when money moves — the server does.

```
┌───────────┐  play(songId)   ┌────────────────┐
│  Client   │ ───────────────▶│  /api/streams  │
│ (browser) │                 │   /start       │
└─────┬─────┘                 └────────┬───────┘
      │                               │ create Stream row (status=STARTED)
      │                               │ enqueue StreamMonitorJob (1s delay)
      │                               │ return { streamId, sessionToken, wsTicket }
      │
      │   WSS connect(streamId, wsTicket)
      ▼
┌────────────────┐
│  Socket.IO     │
│  gateway :3001 │
│  room:stream:* │
└─────┬──────────┘
      │ on 'play' event (with session token + monotonic timestamp)
      │   → server validates via SessionService
      │   → writes PlaybackTick row (position_sec, monotonicMs)
      │   → emits 'ack' back to client
      │
      │ client emits 'position' every 5s (current playhead seconds)
      │
      │   server logic:
      │     if (position >= threshold(0.25 * duration)
      │         && !stream.charged
      │         && monotonic elapsed > 30s (anti-bot)
      │         && no seek > 30s within last 10s (anti-skip)):
      │         stream.charged = true
      │         enqueue PaymentJob (priority=high)
      │         emit 'payment_due' to client
      │
      │ client receives 'payment_due' → opens x402 authorize modal
      │ (or auto-signs via pre-authorized session wallet)
      │ client emits 'payment_signed' with EIP-712 signature
      │
      ▼
┌────────────────────┐         ┌────────────────────────────┐
│ Fan Agent worker   │ ───────▶│ Circle Gateway facilitator │
│ - verify sig       │         │ POST /v1/x402/settle       │
│ - settle batch     │ ◀───────│ returns transferId         │
│ - enqueue Split    │         └────────────────────────────┘
│ - mark Payment     │
│   (status=SETTLED) │
└────────┬───────────┘
         │ on success → enqueue SplitJob
         ▼
┌────────────────────┐         ┌────────────────────────────┐
│ Split Agent worker │ ───────▶│ Arc USDC contract           │
│ - resolve wallet   │         │ transfer(recipient, share)  │
│   addresses from   │         │ (called per recipient,      │
│   song.recipients  │         │  via split processor        │
│ - sum = 100%       │         │  contract)                  │
│ - submit distribution│       │                              │
│ - write Payout rows│         └────────────────────────────┘
│ - emit 'payout_done'
│   on the stream socket room
└────────────────────┘
```

### Anti-abuse guards (server-side, never trust the client)

| Threat | Server-side guard |
|---|---|
| Client lies about position | Server tracks monotonic ticks; client position must be within 1s tolerance of (lastTick + 5s) |
| Replay fraud | `Stream.id` is UUID; payments are idempotent by `(streamId, songId)` — DB unique constraint |
| Seeking to skip ads / skip threshold then return | Detect seek > 30s within last 10s → reset threshold counter to zero |
| Bot streams (multiple devices, same user, <1s apart) | Per-user active-stream cap = 1; per-IP concurrent-stream cap = 3 |
| Threshold-trigger race (two ticks fire) | Redis SETNX on `stream:{id}:charged` before enqueueing payment |
| Double payment per stream | Payment row unique on `streamId`; gateway facilitator is also idempotent by `nonce` |
| Front-running the EIP-712 signature | Signatures include `validBefore = now + 60s`, `nonce` is a UUID burned on first use |

---

## 5. AI Agents (BullMQ-backed)

All three agents are **modules with side-effect-free decision logic**, wrapped by **job handlers** that load context from DB, call the decision function, and write the result. They share the same Redis queue cluster.

### 5.1 Curator Agent

**Queue**: `agent:curator`
**Trigger**: enqueued on `song.finalized` upload event (after upload to R2 completes)
**SLA**: 1 minute (per spec)

Decision function inputs:
- `Song` row (title, artist name, featured, producer, description, audio URL, cover URL, duration, artist price)
- `User` rows for each tagged Pazzera username
- `AudioMetadata` (duration in seconds, bitrate, sample rate, channel count from ffprobe)
- `Reputation` for artist (existing approved songs, rejection rate)

Decision function outputs:
```
{
  decision: 'approved' | 'rejected' | 'needs_changes',
  publishedPriceUsdc: number,   // 0.001–0.005, may differ from artist's pick
  reasons: string[],
  metadata: {
    metadataScore: 0..1,
    audioQualityScore: 0..1,
    spamScore: 0..1,
    duplicateOfSongId: string | null
  }
}
```

Rules:
- `spamScore > 0.7` → reject
- `duplicateOfSongId != null` → reject with reason "Duplicate of <title>"
- `audioQualityScore < 0.3` → reject
- `metadataScore < 0.5` → needs_changes
- Otherwise approve, may lower price by up to 50% if metadata is weak

### 5.2 Fan Agent

**Queue**: `agent:fan`
**Trigger**: enqueued by `StreamMonitorJob` when threshold reached

Decision function: pure — given a `Stream` row, decides whether to enqueue `PaymentJob`. Returns:
```
{ shouldCharge: boolean, reason: string }
```

Reads guard state from Redis (`stream:{id}:charged`) and DB (Stream.status, monotonic tick integrity).

### 5.3 Split Agent

**Queue**: `agent:split`
**Trigger**: enqueued after a `Payment` is SETTLED

Decision function: pure — given `Payment` + `Song.recipients[]`, generates a list of `(recipientAddress, shareUsdc)` transfers and submits them to the on-chain split processor contract. Sum must equal `100.0%` (rejects otherwise, raises alarm). Returns:
```
{
  payoutIds: string[],
  txHashes: string[],
  totalDistributedUsdc: string
}
```

### 5.4 Job / worker topology

```
redis ──┬─ bull queue: agent:curator    ── worker: curatorWorker (concurrency=4)
        ├─ bull queue: agent:fan        ── worker: fanWorker     (concurrency=32)
        ├─ bull queue: agent:split      ── worker: splitWorker   (concurrency=8)
        ├─ bull queue: payment:settle   ── worker: settleWorker
        ├─ bull queue: stream:monitor   ── worker: monitorWorker (recurring)
        └─ bull queue: maintenance      ── worker: maintenanceWorker (nightly)
```

Workers run as separate `node` processes under PM2 inside the same Docker image.

---

## 6. Authentication Flow

Passwordless email OTP via Resend.

```
client                  /api/auth/request-otp          Resend
  │  POST {email}        ───────────────────────────▶   │
  │                                                    │ send OTP email
  │   { ok: true,        ◀───────────────────────────   │
  │     cooldownSec }                                  │
  │                                                    │
  │  POST {email, code}  /api/auth/verify-otp          │
  │   ─────────────────────────────────────────────▶   │
  │   server:                                             │
  │     1. lookup OTP, verify hash, check expiry (10 min) │
  │     2. check rate-limit (5/hr per email, 10/15min per IP) │
  │     3. find or create User                           │
  │        if new user: create Wallet (Phase 4)          │
  │     4. mint sessionId (opaque, 32B random)           │
  │     5. write Session row in DB                       │
  │     6. Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax │
  │   ◀─────────────────────────────────────────────    │
  │   { user, wallet, session }                         │
  │                                                      │
  │  GET /api/auth/session                                │
  │   → returns current user + wallet or 401             │
```

Cookies: `HttpOnly`, `Secure` (in prod), `SameSite=Lax`, `Path=/`, 30-day expiry, sliding refresh.
Session storage: DB (`Session` table). For horizontal scale-out later, swap to Redis-backed sessions without changing API surface.

---

## 7. Wallet Lifecycle

Every account gets a wallet at signup. Never exposed to client beyond the public address.

```
signup ──▶ WalletService.createForUser(userId)
              │
              ├─ generate random secp256k1 keypair (viem)
              ├─ encrypt private key with AES-256-GCM
              │     key = HKDF(masterKey, userId)
              │     masterKey = env.WALLET_MASTER_KEY (32 bytes hex)
              ├─ write Wallet row:
              │     { id, userId, address, encBlob, createdAt }
              ├─ enqueue WalletProvisionJob → registers wallet on Arc (if needed)
              └─ return public address to API layer (private key never leaves server)
```

Deposit flow:
1. Listener opens `/wallet`, copies deposit address (or scans QR).
2. External transfer → Arc USDC contract `Transfer` event indexed by our `walletIndexer` worker.
3. Worker credits `Wallet.balanceUsdc` (cached) and writes `Transaction` row.

Withdraw flow:
1. Listener enters destination address + amount.
2. Server signs USDC `transfer(destination, amount)` with wallet's decrypted private key (in-memory only).
3. Submits to Arc, waits for `receipt`, writes `Transaction` + `Withdrawal` rows.

Streaming payment flow: see section 4 — EIP-712 `TransferWithAuthorization` signed by listener's wallet, settled via Circle Gateway facilitator, then distributed by Split agent.

---

## 8. Environment Variable Schema

All env vars are validated at boot with Zod (`packages/core/src/config/env.ts`). The app refuses to start if anything is missing or malformed.

```bash
# ─────────── Runtime ───────────
NODE_ENV=production                  # development | production | test
PORT=3000                            # Next.js HTTP
SOCKET_PORT=3001                     # Socket.IO server
APP_BASE_URL=https://pazzera.com     # used for callbacks, email links, CORS origin allowlist
LOG_LEVEL=info                       # debug | info | warn | error

# ─────────── Database ───────────
DATABASE_URL=postgresql://pazzera:***@postgres:5432/pazzera?schema=public&sslmode=disable
# In production, postgres runs in Docker on the same host. sslmode=disable because
# the DB is on a private docker network. For external DBs set sslmode=require.

# ─────────── Redis ───────────
REDIS_URL=redis://redis:6379/0

# ─────────── Session / Cookies ───────────
SESSION_COOKIE_NAME=sid
SESSION_TTL_SECONDS=2592000          # 30 days
COOKIE_SECRET=***                    # used for CSRF token signing (HMAC)

# ─────────── Auth (Resend OTP) ───────────
RESEND_API_KEY=re_***
RESEND_FROM_EMAIL=no-reply@pazzera.com
OTP_TTL_SECONDS=600                  # 10 minutes
OTP_LENGTH=6
OTP_RATE_LIMIT_PER_EMAIL_PER_HOUR=5
OTP_RATE_LIMIT_PER_IP_PER_15MIN=10

# ─────────── Security ───────────
WALLET_MASTER_KEY=***                # 32 random bytes hex (64 chars); AES-256-GCM key
CSRF_SECRET=***                      # 32+ chars; HMAC for double-submit tokens
RATE_LIMIT_REDIS_PREFIX=rl:
ALLOWED_ORIGINS=https://pazzera.com,https://www.pazzera.com

# ─────────── Storage (Cloudflare R2) ───────────
STORAGE_PROVIDER=r2                  # r2 | s3
R2_ACCOUNT_ID=***
R2_ACCESS_KEY_ID=***
R2_SECRET_ACCESS_KEY=***
R2_BUCKET=pazzera-media
R2_PUBLIC_BASE_URL=https://media.pazzera.com   # custom domain on the bucket
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com

# ─────────── Blockchain — Arc Testnet ───────────
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_EXPLORER_URL=https://testnet.arcscan.app
USDC_CONTRACT_ADDRESS=0x3600000000000000000000000000000000000000
USDC_DECIMALS=6

# ─────────── Circle Gateway / x402 ───────────
CIRCLE_API_KEY=***
CIRCLE_APP_ID=***
CIRCLE_GATEWAY_FACILITATOR_URL=https://gateway-api-testnet.circle.com
X402_NETWORK_ID=eip155:5042002
GATEWAY_WALLET_ADDRESS=0x0077777d7EBA4688BDeF3E311b846F25870A19B9

# ─────────── AI Agents ───────────
CURATOR_PRICE_MIN_USDC=0.001
CURATOR_PRICE_MAX_USDC=0.005
FAN_AGENT_DURATION_THRESHOLD_PCT=25
SPLIT_DEFAULT_ARTIST_PCT=70
SPLIT_DEFAULT_FEATURED_PCT=20
SPLIT_DEFAULT_PRODUCER_PCT=10

# ─────────── Admin ───────────
ADMIN_EMAILS=ruzky@pazzera.com        # comma-separated allowlist

# ─────────── Observability (optional, Phase 11) ───────────
SENTRY_DSN=
```

### Secrets handling

- `.env` is in `.gitignore` from day one.
- `.env.example` is committed with placeholders.
- Production values live in `docker-compose.yml` `secrets:` block or pulled from Contabo `/etc/pazzera/secrets.env` (chmod 600).
- No secret ever appears in logs (logger redacts `*KEY`, `*SECRET`, `*TOKEN`).

---

## 9. Dependency List & Reasoning

### Runtime dependencies

| Package | Why | Used by |
|---|---|---|
| `next` 14.x | Frontend + API routes + SSR | `apps/web` |
| `react`, `react-dom` | UI | `apps/web` |
| `typescript` 5.x | Type safety end-to-end | all packages |
| `tailwindcss` | Styling | `apps/web` |
| `shadcn/ui` (Radix UI primitives + class-variance-authority) | Accessible component primitives | `apps/web/components/ui` |
| `prisma`, `@prisma/client` | ORM, migrations, generated types | `packages/db` |
| `ioredis` | Redis client (BullMQ backend) | `packages/queue`, `packages/realtime`, rate limiter |
| `bullmq` | Job queues, retries, scheduling | `packages/queue` |
| `socket.io`, `socket.io-client` | Realtime gateway + browser client | `packages/realtime`, `apps/web` |
| `viem` | EVM client, ABI typing, EIP-712 signing | `packages/blockchain` |
| `@circle-fin/user-controlled-wallets` | Circle W3S wallet SDK (signup provisioning) | `packages/blockchain` |
| `@x402/core`, `@x402/evm`, `@circle-fin/x402-batching` | x402 protocol + Gateway batch settlement | `packages/blockchain` |
| `resend` | OTP email delivery | `apps/web/app/api/auth/*` |
| `zod` | Runtime validation (env, request bodies, OTPs) | every package |
| `bcryptjs` | OTP code hashing | `packages/core/utils` |
| `cookie` | Cookie parsing/serialization | `packages/core/middleware` |
| `iron-session` alternative → we use DB sessions directly | — | — |
| `pino` + `pino-pretty` (dev) | Structured JSON logging | `packages/core/utils/logger` |
| `fluent-ffmpeg` (or static `ffprobe` binary) | Audio metadata extraction (duration, bitrate) | `packages/agents/curator` |
| `aws-sdk/client-s3` | S3-compatible R2 client | `packages/storage` |
| `qrcode` | Deposit address QR | `apps/web/components/wallet` |
| `react-hook-form` + `@hookform/resolvers` + `zod` | Forms (upload, onboarding) | `apps/web/components/upload` |
| `next-themes` | Dark mode toggle | `apps/web` |
| `sonner` | Toast notifications | `apps/web` |
| `lucide-react` | Icons | `apps/web` |
| `@tanstack/react-query` | Client-side data fetching/caching | `apps/web` |

### Dev dependencies

| Package | Why |
|---|---|
| `vitest`, `@vitest/coverage-v8` | Unit/integration tests |
| `@playwright/test` | E2E tests |
| `eslint`, `@typescript-eslint/*`, `eslint-plugin-import` | Linting + dependency-boundary enforcement |
| `prettier` | Formatting |
| `tsx` | Dev runtime for workers |
| `dotenv-cli` | Local `.env` loading for non-Next processes (workers) |
| `husky`, `lint-staged` | Pre-commit hooks |
| `cspell` | Spell check (catches typos in copy) |

### System-level (in Docker)

| Tool | Why |
|---|---|
| `ffmpeg` / `ffprobe` | Audio metadata (curator agent) |
| `nginx` | Reverse proxy, static, gzip, rate limit at edge |
| `certbot` (or `acme.sh`) | Let's Encrypt TLS certs |
| `postgres` 16 | Database |
| `redis` 7 | Cache, queues, sockets |

### Explicitly NOT using

- **No hardhat / foundry in the app.** Contract addresses are config; we don't deploy contracts from this repo (they're on Arc testnet).
- **No NextAuth.** We're doing custom OTP flow; NextAuth would fight us on session shape.
- **No tRPC.** Route handlers + Zod schemas are simpler and easier to deploy.
- **No Express server.** Socket.IO lives in its own process, not bolted onto Next.js custom server (which would lose serverless-ready features).

---

## 10. Cross-cutting Concerns

### 10.1 Logging

- Structured JSON via `pino`. Every line has `service`, `requestId`, `userId` (if any).
- Log redaction list: `privateKey`, `seed`, `mnemonic`, `otp`, `code`, `password`, `token`, `apiKey`, `secret`.
- In dev: `pino-pretty` for readability.
- In prod: stdout → Docker log driver → rotated by `logrotate`.

### 10.2 Error handling

- Typed error classes in `packages/core/utils/errors.ts`: `AppError`, `ValidationError`, `AuthError`, `PaymentError`, `RateLimitError`, `NotFoundError`, `ConflictError`.
- API route handlers wrap logic in `withApi(handler)` that converts `AppError` to JSON `{ error: { code, message } }` with correct status. Unknown errors → 500 with request ID.

### 10.3 Rate limiting

- Two layers: edge (Nginx `limit_req`) for `/api/auth/*` and `/api/streams/*`; app (Redis token bucket via `rate-limiter-flexible`).
- Keys: IP for unauthenticated, `userId` for authenticated.

### 10.4 CSRF

- Double-submit cookie pattern. On session mint, server issues `csrf` cookie (NOT HttpOnly). Client reads it and echoes in `x-csrf-token` header on POST/PUT/DELETE.
- Same-origin enforced via `Origin`/`Referer` allowlist.

### 10.5 CSP / security headers

- `Content-Security-Policy` set in `next.config.mjs` and reasserted in Nginx.
- `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` all on.

### 10.6 Database access

- All writes go through repository functions in `packages/db/src/repositories/*.ts`. Route handlers never import `@prisma/client` directly.
- This makes future extract-to-microservice trivial (each repo becomes a service interface).

---

## 11. Phased Delivery Map (this build)

| Phase | Deliverable | Status |
|---|---|---|
| 1 | Architecture, folder structure, env schema, dependency list, diagrams (this document) | ✅ |
| 2 | Prisma schema + initial migration; repository scaffolding | ⏳ |
| 3 | OTP auth, session, middleware, CSRF, rate limiting | ⏳ |
| 4 | WalletService, AES-256-GCM encryption, Arc adapter (read-only), deposit address display | ⏳ |
| 5 | Frontend UI: landing, auth, dashboards, player, song page, wallet, admin, profile | ⏳ |
| 6 | Upload modal, presigned R2 upload, audio metadata, waveform, finalize endpoint | ⏳ |
| 7 | Curator, Fan, Split agents + BullMQ workers + admin log viewer | ⏳ |
| 8 | Streaming engine: Socket.IO gateway, playback ticks, threshold detection, anti-abuse | ⏳ |
| 9 | Nano payment: EIP-712 sign, Circle Gateway settle, Split distribution, payout receipts | ⏳ |
| 10 | Vitest unit tests, Playwright e2e | ⏳ |
| 11 | Docker, Nginx, PM2, SSL, DNS, backups, deploy script, rollback | ⏳ |

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Circle / Arc testnet downtime breaks payment demo | Payment queue has retry-with-backoff (10s, 30s, 2m, 10m); admin page shows `pending` payments clearly |
| R2 quota or credentials missing during deploy | Storage adapter has `local` fallback for dev only (writes to `./tmp/`); production hard-fails if R2 not configured |
| Contabo VPS is slow for ffprobe | Curator agent runs ffprobe on the upload worker process; we cap concurrency=4 to avoid CPU spike |
| Bot streams bypassing threshold | Server-authoritative monotonic ticks + per-user active-stream cap + per-IP cap + Cloudflare Turnstile on signup (optional, Phase 11) |
| Wallet private key leak via logs | Logger redaction + AES-256-GCM with per-user HKDF salt; no raw key ever touches a variable named plainly in a log line |
| pnpm workspace gotchas (top-level dirs missing from globs) | `pnpm-workspace.yaml` explicitly lists every package directory; verified in CI |
| Single VPS failure = total outage | Automated nightly Postgres backup to `/var/backups/pazzera/`; `restore-postgres.sh` documented; Cloudflare R2 keeps media safe independently of the DB |