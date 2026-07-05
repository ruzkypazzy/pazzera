# Pazzera

> **Decentralized pay-per-listen music streaming on Arc Testnet.**
> Every stream past the 25% threshold fires a USDC nano payment
> directly to the artist — no middlemen, no monthly fees, no
> waiting months for royalties.

[![typecheck](https://img.shields.io/badge/typecheck-0%20errors-2ea043)]()
[![tests](https://img.shields.io/badge/tests-91%20passing-2ea043)]()
[![strict](https://img.shields.io/badge/typescript-strict-2ea043)]()
[![license](https://img.shields.io/badge/license-MIT-2ea043)]()
[![x402](https://img.shields.io/badge/payments-x402%20%2B%20Circle%20Gateway-7B5EFF)]()
[![next.js](https://img.shields.io/badge/next.js-14-black)]()
[![node](https://img.shields.io/badge/node-20%2B-339933)]()

---

## What Pazzera actually does

1. **Sign in** with email + one-time code (Argon2id-hashed at rest,
   Resend-delivered, rate-limited 5/hr).
2. **Discover** music with explainable AI agents (Curator, Fan,
   Split, Discovery, Fraud-Sentinel) — every decision is logged.
3. **Press play** — the listener-side `StreamAggregator` streams
   ticks to the realtime socket over WebSocket.
4. **Cross 25%** — the Fan Agent calculates a fair per-stream price
   based on the artist's catalog and signals a `payment_due` event.
5. **Sign x402 envelope** — a one-time EIP-712
   `TransferWithAuthorization` for USDC, valid for 60 seconds.
6. **Settle** — the facilitator submits to Circle Gateway, returns
   `txHash + blockNumber` in <10s p95.
7. **Split** — the Split Agent fans out to every RoyaltyRecipient
   according to their `splitPercentageBps`.

Every step is auditable from the admin dashboard (decisions,
review-queue, fraud-alerts, payment timelines, agent health).

### New: PAZZERA BOT — conversational AI upload agent

Hit **Upload a track** anywhere in the app and you'll meet the AI
upload agent. Drop your audio + cover, chat about the vibe, and the
bot:

- Analyzes audio (duration, bitrate, channels, energy, mood from ID3
  tags) via `music-metadata` + heuristics
- Captions the cover art via GPT-4o vision
- Suggests title, description, mood tags, audio quality, **fair
  per-stream rate (0.001–0.005 USDC, never rejects)** via GPT-4o-mini
- Resolves Pazzera `@username` recipients against the DB (with
  fuzzy "did you mean?" if there's a prefix match)
- Drives the LOCKED `/api/songs/create-draft` →
  `/api/upload/{audio,cover,finalize}` pipeline internally
- Returns the new `songId` and confirms "Submitted to Curator ✓"

The bot is a real LLM-backed chatbot: every free-form message goes
through OpenAI with a persona + current upload context. You can ask
"What's a fair rate?", "How does Curator work?", or "Tell me a joke
about producers" — it answers intelligently while still being able
to recognize when you upload files.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Cloudflare (DNS + CDN)                     │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Contabo VPS (single monolith)                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Next.js 14 — apps/web (:3000)                                  │  │
│  │  ├─ App Router + RSC                                            │  │
│  │  ├─ PAZZERA BOT chatbot at /upload                              │  │
│  │  ├─ Admin dashboard                                             │  │
│  │  └─ Realtime-aware player                                       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Socket.IO server — packages/realtime (:3001)                   │  │
│  │  Server-authoritative StreamAggregator (25% threshold)           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  BullMQ workers — pazzera-worker container                       │  │
│  │  ├─ 5 agents: curator / fan / split / discovery / fraud         │  │
│  │  ├─ 4 upload workers: audio / waveform / preview / cover       │  │
│  │  ├─ indexer, provision, reconcile, analytics rollup              │  │
│  │  └─ payment:settle (x402 → Circle Gateway)                      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Postgres (port 5432)                                          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Redis (port 6379) — nonces, queues, rate limits, replay        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Cloudflare R2 (audio / covers / waveforms / previews)           │  │
│  │  OR local filesystem in dev (`/opt/pazzera/.local-storage`)      │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  External services                                                    │
│  ├─ Arc Testnet (RPC + explorer, chainId 5042002)                    │
│  ├─ Circle Gateway facilitator (x402 settlement)                       │
│  ├─ USDC contract: 0x3600..0000 on Arc                                │
│  ├─ Circle Programmable Wallets (artist + listener custody)           │
│  └─ Resend (transactional email; OTP delivery + receipts)             │
└──────────────────────────────────────────────────────────────────────┘
```

### Monorepo layout

```
pazzera/
├─ apps/
│  └─ web/                              Next.js app + e2e tests
│     ├─ app/
│     │  ├─ (app)/                      authenticated routes (home, upload, wallet…)
│     │  │  └─ upload/                  PAZZERA BOT chatbot page
│     │  ├─ (auth)/                     sign-in / sign-up / verify-otp
│     │  ├─ (marketing)/                marketing landing
│     │  └─ api/
│     │     ├─ agent/                   🤖 AI upload agent endpoints
│     │     │  ├─ upload/message/        chat POST/GET, files (multipart)
│     │     │  ├─ upload/commit/         drives LOCKED pipeline
│     │     │  └─ upload/stage/         auth-gated file reader
│     │     ├─ auth/                    OTP + session + csrf
│     │     ├─ upload/                  LOCKED — audio/cover/finalize
│     │     ├─ songs/                   create-draft, search, [id]
│     │     ├─ wallet/                  topup, balance, withdraw
│     │     ├─ x402/                    payment endpoints
│     │     ├─ stats/                   platform stats (PUBLIC)
│     │     └─ webhooks/                Circle HMAC-SHA256
│     └─ components/
│        ├─ agent/                      AgentChat + MessageBubble
│        └─ artist/                     upload-dialog + BecomeArtistButton
│
├─ packages/
│  ├─ core/                             env, auth, services, middleware, logger
│  ├─ db/                               Prisma schema + repositories + utils
│  ├─ queue/                            BullMQ topology + helpers (cross-package)
│  ├─ realtime/                         Socket.IO server + protocol + nonces
│  ├─ storage/                          R2 / S3 / local-with-presign adapter
│  ├─ blockchain/                       wallet providers + x402 + facilitator
│  ├─ agents/                           5 agents + workers + decision functions
│  │  └─ src/upload-agent/              🤖 the AI upload bot
│  │     ├─ llm.ts                      OpenAI wrapper (chat/chatVision/chatText)
│  │     ├─ analyze.ts                  music-metadata + energy heuristics
│  │     ├─ decide.ts                   gpt-4o-mini JSON-mode decision
│  │     └─ router.ts                   state machine
│  └─ upload/                           upload pipeline + workers + fingerprint
│
├─ types/                               shared `.d.ts` stubs (next/server, resend)
├─ tsconfig.base.json                    strict TypeScript config (root)
├─ docker/
│  ├─ Dockerfile.web                     Next.js standalone image
│  ├─ Dockerfile.worker                  BullMQ workers image
│  └─ nginx.conf
├─ docker-compose.yml
├─ LOCKED_BASELINE.md                   enumerates files locked during AI agent build
├─ LOCK_GATE.sh                         pre-commit script that diffs vs locked tag
├─ PAZZERA_STATE_SNAPSHOT.md            runtime + DB state at last save
├─ PAZZERA_BACKEND_SNAPSHOT.md          route + Prisma model inventory
├─ PAZZERA_DESIGN_TOKENS.md             colors, spacing, components
├─ PAZZERA_COMPONENT_INVENTORY.md       all UI components, purpose, props
├─ CHANGELOG.md                         running change log
├─ LICENSE                              MIT (see below)
└─ README.md                            you are here
```

### How the AI Upload Agent talks to the pipeline

```
┌──────────────┐  ┌────────────────────┐  ┌─────────────────────────┐
│  AgentChat   │─▶│ /api/agent/upload/  │─▶│ /api/songs/create-draft │
│  (browser)   │  │   message (multipart│  │   (LOCKED, returns songId) │
│              │  │   audio/cover, JSON │  └────────┬────────────────┘
│              │  │   text input)       │           │
│              │  └─────────┬──────────┘           │
│              │            │                      │
│              │  ┌─────────▼──────────┐  ┌────────▼─────────────────┐
│              │◀─│ OpenAI gpt-4o-mini  │  │ /api/upload/audio (multipart)
│              │  │ decide.ts + router │  │ /api/upload/cover (multipart)
│              │  │ llm.ts             │  │ /api/upload/finalize        │
│              │  └────────────────────┘  └─────────────┬──────────────┘
│              │            │                          │
│              │            ▼                          ▼
│              │   state='committed'          song status='processing'
│              │   success card ✓             audio worker → waveform → preview → cover → curator
└──────────────┘
```

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | Next.js 14 (App Router, RSC) | First-class SSR + streaming + server actions |
| **Realtime** | Socket.IO over WebSocket | Battle-tested, plays nicely with Cloudflare |
| **Database** | Postgres 16 | Triggers, partial indexes, JSONB, RLS-ready |
| **ORM** | Prisma | Type-safe migrations, deterministic client |
| **Queue** | BullMQ on Redis 7 | Priority queues, retries with backoff, repeatable jobs |
| **Storage** | Cloudflare R2 (S3-compatible) | S3 API + presigned URLs + zero egress |
| **Auth** | Email + OTP, Argon2id at rest | Passwordless; OTP TTL 10 min; rate-limited 5/hr |
| **Crypto** | viem for EIP-712, HKDF master key, AES-256-GCM at rest | Battle-tested primitives |
| **Payments** | x402 + Circle Gateway | One-time EIP-712 TransferWithAuthorization, settled by facilitator |
| **Chain** | Arc Testnet (chainId 5042002) | USDC contract at `0x3600000000000000000000000000000000000000` |
| **AI Agent** | OpenAI gpt-4o-mini + gpt-4o-vision | Cheap JSON-mode decisions, accurate vision captions |
| **Workers** | tsx (no build step) + Docker (Debian + libssl3 for Prisma) | Reproducible, fast startup |
| **Logs** | pino (structured JSON) | Pipe to any log shipper |
| **Tests** | Vitest (unit), Playwright (e2e) | 91 deterministic tests, strict TS |

### Strict typing & tests

```
0 TypeScript errors repo-wide · strict mode ON · 91 deterministic tests
```

```bash
pnpm -r typecheck                     # all packages + web
pnpm -r test                          # 91 deterministic tests
pnpm --filter @pazzera/web test:e2e   # Playwright (live server)
```

---

## Environment variables

`packages/core/src/config/env.ts` is the canonical Zod schema. When
the server starts, every variable is validated at boot — startup
fails loudly if anything is wrong.

### Required core
| Name | Purpose |
|---|---|
| `COOKIE_SECRET` | session signing (≥32 chars) |
| `CSRF_SECRET` | double-submit CSRF token (≥32 chars) |
| `WALLET_MASTER_KEY` | HKDF master key (64-hex) |
| `ENCRYPTION_KEY` | AES-256-GCM at-rest (64-hex) |
| `DATABASE_URL` | Postgres or SQLite |
| `REDIS_URL` | BullMQ + nonces + rate-limit |
| `RESEND_API_KEY` | transactional email |
| `RESEND_FROM_EMAIL` | sender envelope |
| `ARC_RPC_URL` | Arc Testnet JSON-RPC endpoint |
| `USDC_CONTRACT_ADDRESS` | USDC ERC-20 on Arc |
| `GATEWAY_WALLET_ADDRESS` | facilitator's wallet |
| `CIRCLE_API_KEY` | Circle Programmable Wallets |

### AI Agent (PAZZERA BOT)
| Name | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai` only today |
| `LLM_API_KEY` | — | OpenAI API key |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | base URL |
| `LLM_MODEL` | `gpt-4o-mini` | decision model |
| `LLM_VISION_MODEL` | `gpt-4o` | vision model for cover captioning |

### Tunables (with sensible defaults)
| Name | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `PORT` | `3000` | Next.js listener |
| `SOCKET_PORT` | `3001` | Socket.IO server |
| `LOG_LEVEL` | `info` | pino level |
| `SESSION_COOKIE_NAME` | `sid` | client cookie |
| `SESSION_TTL_SECONDS` | `2592000` | 30 days |
| `OTP_TTL_SECONDS` | `600` | 10 min |
| `OTP_LENGTH` | `6` | digits |
| `OTP_RATE_LIMIT_PER_EMAIL_PER_HOUR` | `5` | anti-bruteforce |
| `STORAGE_PROVIDER` | `r2` | `r2` / `s3` / `local` |
| `ARC_CHAIN_ID` | `5042002` | Arc testnet chain id |
| `ARC_EXPLORER_URL` | `https://testnet.arcscan.app` | explorer URL for tx links |
| `USDC_DECIMALS` | `6` | |
| `CIRCLE_APP_ID` | — | |
| `CIRCLE_BASE_URL` | `https://api.circle.com` | |
| `CIRCLE_GATEWAY_FACILITATOR_URL` | `https://gateway-api-testnet.circle.com` | x402 settlement |
| `CIRCLE_WEBHOOK_SECRET` | — | HMAC-SHA256 for /api/webhooks/circle |
| `CURATOR_PRICE_MIN_USDC` / `CURATOR_PRICE_MAX_USDC` | `0.001` / `0.005` | curator pricing band (the agent never rejects, always clamps) |
| `FAN_AGENT_DURATION_THRESHOLD_PCT` | `25` | payment trigger threshold |
| `SPLIT_DEFAULT_ARTIST_PCT` etc. | `70` / `20` / `10` | default royalty split |
| `PAZZERA_WALLET_PROVIDER` | `local-dev` | `local-dev` / `circle-ucw` / `arc-native` |
| `WALLET_DAILY_WITHDRAW_CAP_USDC` | `1000` | |
| `WALLET_WITHDRAW_COOLDOWN_SECONDS` | `60` | |
| `WALLET_X402_DAILY_CAP_USDC` | `5` | Option-B delegated spend cap |
| `WALLET_X402_PER_STREAM_CAP_USDC` | `0.01` | per-stream cap |
| `INDEXER_BATCH_SIZE` | `500` | blocks per cycle |
| `INDEXER_INTERVAL_SECONDS` | `15` | poll interval |
| `ADMIN_EMAILS` | `''` | comma-separated admin allow-list |
| `DEMO_MODE` | `false` | demo simulation loop (5 listeners) |
| `PAZZERA_TEST_API_ENABLED` | `false` | dev/test only; exposes /api/auth/test-* and /api/realtime/test-*. **NEVER enable in production** |

---

## Quick start (local dev)

```bash
# 1. Start backing services
docker compose up -d postgres redis

# 2. Install + generate Prisma client + push schema
pnpm install
pnpm --filter @pazzera/db prisma generate
pnpm --filter @pazzera/db db:push

# 3. Env
cp .env.example .env
# Minimum viable set for local dev:
#   DATABASE_URL=postgresql://pazzera:pazzera@localhost:5432/pazzera
#   REDIS_URL=redis://localhost:6379
#   COOKIE_SECRET=$(openssl rand -hex 32)
#   CSRF_SECRET=$(openssl rand -hex 32)
#   WALLET_MASTER_KEY=$(openssl rand -hex 32)
#   ENCRYPTION_KEY=$(openssl rand -hex 32)
#   ARC_RPC_URL=https://rpc.testnet.arc.network
#   USDC_CONTRACT_ADDRESS=0x3600000000000000000000000000000000000000
#   GATEWAY_WALLET_ADDRESS=0x0077777d7EBA4688BDeF3E311b846F25870A19B9
#   CIRCLE_API_KEY=<your circle api key>
#   RESEND_API_KEY=<your resend api key>
#   RESEND_FROM_EMAIL=Pazzera <noreply@pazzera.com>
#   LLM_API_KEY=<your openai api key>
#   LLM_MODEL=gpt-4o-mini
#   ALLOWED_ORIGINS=http://localhost:3000
#   NODE_ENV=development

# 4. Run (in separate terminals or as background)
pnpm dev                                  # apps/web (Next.js) on :3000
pnpm --filter @pazzera/realtime start     # Socket.IO on :3001
pnpm --filter @pazzera/agents start       # BullMQ workers

# 5. Verify
curl http://localhost:3000/ready
pnpm -r typecheck
pnpm -r test
```

### Test the AI Agent locally

```bash
cd packages/agents
pnpm tsx scripts/test-upload-agent.ts /path/to/song.mp3 /path/to/cover.jpg
# Calls analyzeAudio + captionCover + decideMetadata end-to-end,
# prints the full decision payload, falls back to deterministic
# defaults if LLM_API_KEY is unset.

pnpm tsx scripts/test-agent-session.ts
# Prisma CRUD smoke test on AgentUploadSession.
```

---

## Deployment runbook

The full production deployment is **one command at a time** per
user preference. Each step explains what to run, why, and the
expected output.

### Prerequisites
- Contabo VPS (Ubuntu 24.04, ≥4GB RAM)
- A fresh domain (e.g. `pazzera.com`) with Cloudflare DNS
- Circle Programmable Wallets API key + App ID
- Arc Testnet RPC URL
- Resend API key + verified sender domain
- Cloudflare R2 bucket + access keys
- OpenAI API key (for the AI Agent)

### 1. SSH into the VPS and install Docker
```bash
ssh <user>@<vps>
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
exec sudo -u $USER bash -l
docker --version
```

### 2. Clone + env
```bash
sudo mkdir -p /opt/pazzera && sudo chown $USER /opt/pazzera
cd /opt/pazzera
git clone https://github.com/ruzkypazzy/pazzera.git .
cp .env.example .env
# Edit .env with production values (see Environment section above).
```

### 3. Bring up Postgres + Redis
```bash
docker compose up -d postgres redis
docker compose ps
```

### 4. Initialize the database
```bash
docker compose run --rm web pnpm --filter @pazzera/db db:push
```

### 5. Build the images (web + worker)
```bash
docker compose build web
docker compose build worker
```

### 6. Bring up all services
```bash
docker compose up -d web worker
docker compose ps
curl http://localhost:3000/ready
```

### 7. Cloudflare + DNS
- Add A records `pazzera.com` and `api.pazzera.com` → `<VPS-IP>` (proxied).
- Enable Cloudflare proxy + Full SSL (strict).

### 8. Nginx + Let's Encrypt
- Install nginx + certbot.
- Add server blocks for `pazzera.com` and `api.pazzera.com`.
- `certbot --nginx -d pazzera.com -d api.pazzera.com`
- Reverse-proxy `http://localhost:3000` and `http://localhost:3001`.

### 9. Smoke test
```bash
curl https://pazzera.com/ready
curl https://api.pazzera.com/ready
```

### 10. Admin bootstrap
- Sign up via the UI.
- Set `ADMIN_EMAILS=...` to include that email.
- Restart the workers: `docker compose restart worker`.
- Visit `/admin` to confirm the role promoted.

### Operational notes
- Logs are JSON-structured via pino. `LOG_LEVEL=info` is sane for prod.
- DB backups: cron `pg_dump` nightly to a private R2 bucket.
- Webhook receiver: `/api/webhooks/circle` (HMAC-SHA256 verified).
- Realtime socket is the only stateful subsystem beyond Postgres;
  it has Redis-backed nonces so a worker crash is recoverable.
- The AI Agent's `LLM_API_KEY` is shared across web + worker but
  only the message endpoint (web) calls OpenAI — workers don't.

---

## The Agent Upload Pipeline (PAZZERA BOT)

### What it does

1. User clicks **Upload a track** anywhere in the app
2. `AgentChat` mounts, fetches/creates a session, sends the greeting
3. User drops an audio file (mp3/wav/m4a/flac) — saved to
   `/app/data/agent-stage/` (in container) or
   `/opt/pazzera/.local-storage/agent-stage/` (on host)
4. User drops a cover image — saved the same way + sent to OpenAI
   vision as a base64 data URL (we can't auth the LLM to our URLs)
5. Agent asks LLM to decide `{title, description, moodTags,
   audioQuality, confidence, reasoning, streamRateUsdc}` (clamped
   to [0.001, 0.005] USDC; **never rejects**)
6. User confirms + edits recipients with Pazzera `@username`s
   (agent fuzzy-searches for prefix matches if username not exact)
7. User clicks **Publish to Pazzera**
8. Commit route internally:
   - Calls `/api/songs/create-draft` (LOCKED) → songId
   - Multipart-POSTs audio to `/api/upload/audio` (LOCKED)
   - Multipart-POSTs cover to `/api/upload/cover` (LOCKED)
   - Resolves internal usernames via Prisma
   - POSTs full metadata + recipients to `/api/upload/finalize` (LOCKED)
   - Marks session as `committed` (closedAt set)
9. Finalize enqueues `upload-process-audio` worker → metadata,
   waveform, preview, cover variants, NSFW check, **curator**
10. Curator Agent reviews and approves/rejects (status: `published`
    or `failed_processing`)
11. User sees success card in chat: **"Submitted to Curator ✓"**
12. Agent auto-replies with confirmation message
13. User can hit **Reset** to start a new track with a fresh session

### Files

```
packages/agents/src/upload-agent/
├─ llm.ts                # OpenAI wrapper: chat() JSON, chatVision(), chatText() free-form, llmHealth()
├─ analyze.ts            # music-metadata + energy/mood heuristics
├─ decide.ts             # gpt-4o-mini JSON-mode decision
└─ router.ts             # state machine + LLM chat fallback

apps/web/app/api/agent/upload/
├─ message/route.ts      # POST multipart/JSON, GET session
├─ commit/route.ts       # drives LOCKED pipeline, resolves recipients
└─ stage/[...key]/       # auth-gated file reader

apps/web/components/agent/
├─ AgentChat.tsx         # chat panel UI
└─ MessageBubble.tsx     # bubble + decision card
```

### Key design decisions

- **AI Agent never rejects**: stream rate is always clamped to
  `[0.001, 0.005]`. Even with `LLM_API_KEY` unset, the bot uses
  deterministic fallbacks so the user can still publish.
- **Only internal Pazzera splits**: external recipients need a
  wallet address the chat flow doesn't collect yet. The agent
  surfaces a clear error if you try.
- **Empty/0% slots are skipped at commit**: producers or featured
  artists with 0% don't trigger "Unknown Pazzera user" errors.
- **Fuzzy recipient search**: typing `ak` suggests
  `@akinulitosin7` automatically.
- **Agent chitchat via LLM**: every free-form message routes
  through `chatText()` with a persona + upload context. You can
  ask it anything music/payment-related and it answers.
- **Chat history clears next session**: session is closed on
  commit (`closedAt` set); the next mount fetches a fresh one.

---

## Testing

```bash
pnpm -r typecheck                     # 0 errors repo-wide
pnpm -r test                          # 91 deterministic tests
pnpm --filter @pazzera/web test:e2e   # Playwright (live server)

# AI Agent smoke tests
cd packages/agents
pnpm tsx scripts/test-upload-agent.ts /path/to/song.mp3
pnpm tsx scripts/test-agent-session.ts
```

---

## Security

- **Session cookies**: HttpOnly, Secure (prod), SameSite=lax,
  HMAC-signed with `COOKIE_SECRET`. DB stores SHA-256(sessionId).
- **CSRF**: double-submit cookie pattern. `csrf` cookie is NOT
  HttpOnly (readable by JS), HMAC of `sid`. Mutating requests must
  echo the value in `x-csrf-token` header.
- **At-rest encryption**: AES-256-GCM with `ENCRYPTION_KEY` for
  sensitive PII (Circle userToken, encryptionKey for custodial wallets).
- **Rate limits**: 5 OTPs/hr/email, 10 logins/15min/IP,
  3 forgot-password/hr/email, x402 spend caps per stream & per day.
- **Replay protection**: payment nonces are single-use, stored in
  Redis with 60s TTL.
- **No public keys in env**: secrets never appear in logs or
  responses. `LOG_LEVEL=debug` masks them.

---

## License

This project is licensed under the **MIT License** — see the
[`LICENSE`](./LICENSE) file for the full text.

```
MIT License

Copyright (c) 2026 Pazzera Contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject
to the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED...
```

---

## Acknowledgements

- [Circle](https://www.circle.com) for Programmable Wallets + Gateway x402
- [Arc](https://www.arc.network) for the USDC testnet
- [OpenAI](https://openai.com) for the conversational + vision models
- [Cloudflare](https://cloudflare.com) for DNS, R2, and the edge
- [Prisma](https://www.prisma.io) + [BullMQ](https://docs.bullmq.io) for the data + queue layer
- [Next.js](https://nextjs.org) for the App Router + RSC
- [Socket.IO](https://socket.io) for the realtime transport
- All the indie artists and listeners out there — you built this with us