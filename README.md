# Pazzera

> Decentralized pay-per-listen music streaming on Arc Testnet.
> Every stream you finish past the 25% threshold sends a USDC nano
> payment directly to the artist — no middlemen, no monthly fees.

[![typecheck](https://img.shields.io/badge/typecheck-0%20errors-2ea043)]()
[![tests](https://img.shields.io/badge/tests-91%20passing-2ea043)]()
[![strict](https://img.shields.io/badge/typescript-strict-2ea043)]()
[![license](https://img.shields.io/badge/license-proprietary-red)]()

## What Pazzera actually does

1. **Sign in** with email + one-time code (Argon2id-hashed at rest).
2. **Discover** music with explainable AI agents (Curator, Fan,
   Split, Discovery, Fraud-Sentinel).
3. **Press play** — the listener-side StreamAggregator streams ticks
   to the realtime socket over WebSocket.
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
│  │  ├─ Admin dashboard                                             │  │
│  │  └─ Realtime-aware player                                       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Socket.IO server — packages/realtime (:3001)                   │  │
│  │  Server-authoritative StreamAggregator (25% threshold)           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  BullMQ workers — packages/agents                               │  │
│  │  ├─ 5 agents (curator / fan / split / discovery / fraud)         │  │
│  │  ├─ 4 upload workers (audio / waveform / preview / cover)       │  │
│  │  ├─ indexer, provision, reconcile, analytics rollup              │  │
│  │  └─ payment:settle (x402 → Circle Gateway)                      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Postgres-in-Docker (port 5432)                                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Redis (port 6379) — nonces, queues, rate limits, replay        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Cloudflare R2 (audio / covers / waveforms / previews)           │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  External services                                                    │
│  ├─ Arc Testnet (RPC + explorer)                                      │
│  ├─ Circle Gateway facilitator (x402 settlement)                       │
│  ├─ USDC contract: 0x3600..0000 on Arc (chainId 5042002)             │
│  └─ Resend (transactional email; OTP delivery + receipts)             │
└──────────────────────────────────────────────────────────────────────┘
```

### Monorepo layout

```
pazzera/
├─ apps/
│  └─ web/                    Next.js app + e2e tests
├─ packages/
│  ├─ core/                   env, auth, services, middleware, logger
│  ├─ db/                     Prisma schema + repositories + utils
│  ├─ queue/                  BullMQ topology + helpers (cross-package)
│  ├─ realtime/               Socket.IO server + protocol + nonces
│  ├─ storage/                R2 / S3 / local-with-presign adapter
│  ├─ blockchain/             wallet providers + x402 + facilitator
│  ├─ agents/                 5 agents + workers + decision functions
│  ├─ upload/                 upload pipeline + workers + fingerprint
│  └─ upload (sibling)        the upload package's tsconfig + stubs
├─ types/                    shared `.d.ts` stubs (next/server, resend)
└─ tsconfig.base.json         strict TypeScript config (root for all packages)
```

### Strict typing & tests

```
0 TypeScript errors repo-wide · strict mode ON · 91 deterministic tests
```

```
pnpm -r typecheck      # all 8 packages + web
pnpm -r test           # 91 deterministic tests
pnpm --filter web test:e2e   # Playwright (live server)
```

## Environment variables

`packages/core/src/config/env.ts` is the canonical Zod schema. When
the server starts, every variable is validated at boot — startup
fails loudly if anything is wrong.

| Name | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes | `development` | `development` / `production` / `test` |
| `PORT` | no | `3000` | Next.js listener |
| `SOCKET_PORT` | yes (prod) | `3001` | Socket.IO server |
| `APP_BASE_URL` | yes | `http://localhost:3000` | CORS + origin checks |
| `LOG_LEVEL` | no | `info` | pino: `debug` / `info` / `warn` / `error` |
| `DATABASE_URL` | yes | `file:./dev.db` | Postgres or SQLite |
| `REDIS_URL` | yes | `redis://localhost:6379` | BullMQ + nonces + rate-limit |
| `SESSION_COOKIE_NAME` | no | `sid` | client cookie |
| `SESSION_TTL_SECONDS` | no | `2592000` | 30 days |
| `COOKIE_SECRET` | yes | (`min 32 chars`) | session signing |
| `CSRF_SECRET` | yes | (`min 32 chars`) | double-submit CSRF token |
| `RESEND_API_KEY` | yes | — | transactional email |
| `RESEND_FROM_EMAIL` | yes | — | sender envelope |
| `OTP_TTL_SECONDS` | no | `600` | 10 min |
| `OTP_LENGTH` | no | `6` | digits |
| `OTP_RATE_LIMIT_PER_EMAIL_PER_HOUR` | no | `5` | anti-bruteforce |
| `WALLET_MASTER_KEY` | yes | — | 64-hex-char; HKDF master key |
| `ALLOWED_ORIGINS` | yes | — | comma-separated CORS allowlist |
| `STORAGE_PROVIDER` | no | `r2` | `r2` / `s3` / `local` |
| `R2_*` / `S3_*` | yes | — | bucket, region, key/secret, public base |
| `ARC_RPC_URL` | yes | — | Arc Testnet JSON-RPC endpoint |
| `ARC_CHAIN_ID` | no | `5042002` | Arc testnet chain id |
| `ARC_EXPLORER_URL` | no | `https://testnet.arcscan.app` | explorer URL for tx links |
| `USDC_CONTRACT_ADDRESS` | yes | — | USDC ERC-20 on Arc |
| `USDC_DECIMALS` | no | `6` | |
| `CIRCLE_API_KEY` | yes | — | Circle Programmable Wallets |
| `CIRCLE_APP_ID` | no | — | |
| `CIRCLE_BASE_URL` | no | `https://api.circle.com` | |
| `CIRCLE_GATEWAY_FACILITATOR_URL` | no | `https://gateway-api-testnet.circle.com` | x402 settlement |
| `CIRCLE_WEBHOOK_SECRET` | no | — | HMAC-SHA256 for /api/webhooks/circle |
| `GATEWAY_WALLET_ADDRESS` | yes | — | facilitator's wallet |
| `CURATOR_PRICE_MIN_USDC` / `CURATOR_PRICE_MAX_USDC` | no | `0.001` / `0.005` | curator pricing band |
| `FAN_AGENT_DURATION_THRESHOLD_PCT` | no | `25` | payment trigger threshold |
| `SPLIT_DEFAULT_ARTIST_PCT` etc. | no | `70` / `20` / `10` | default royalty split |
| `PAZZERA_WALLET_PROVIDER` | no | `local-dev` | `local-dev` / `circle-ucw` / `arc-native` |
| `WALLET_DAILY_WITHDRAW_CAP_USDC` | no | `1000` | |
| `WALLET_WITHDRAW_COOLDOWN_SECONDS` | no | `60` | |
| `WALLET_X402_DAILY_CAP_USDC` | no | `5` | Option-B delegated spend cap |
| `WALLET_X402_PER_STREAM_CAP_USDC` | no | `0.01` | per-stream cap |
| `INDEXER_BATCH_SIZE` | no | `500` | blocks per cycle |
| `INDEXER_INTERVAL_SECONDS` | no | `15` | poll interval |
| `ADMIN_EMAILS` | no | `''` | comma-separated admin allow-list |
| `DEMO_MODE` | no | `false` | demo simulation loop (5 listeners) |
| `PAZZERA_TEST_API_ENABLED` | **dev/test only** | `false` | exposes /api/auth/test-* and /api/realtime/test-*; NEVER enable in production |

## Quick start (local dev)

```
# 1. Start backing services
docker compose up -d postgres redis

# 2. Install + generate Prisma client + push schema
pnpm install
pnpm --filter @pazzera/db prisma generate
pnpm --filter @pazzera/db db:push

# 3. Env
cp .env.example .env
# Edit .env; the smallest viable set:
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
#   ALLOWED_ORIGINS=http://localhost:3000
#   NODE_ENV=development

# 4. Run
pnpm dev               # apps/web (Next.js) on :3000
pnpm --filter @pazzera/realtime start   # Socket.IO on :3001
pnpm --filter @pazzera/agents start     # BullMQ workers

# 5. Test
pnpm -r typecheck
pnpm -r test
pnpm --filter @pazzera/web test:e2e
```

## Deployment runbook

The full production deployment (Phase 11) is **one command at a
time** per user preference. Each step below explains what to run,
why, and the expected output.

### Prerequisites
- Contabo VPS (Ubuntu 24.04, ≥4GB RAM)
- A fresh domain (e.g. `pazzera.com`) with Cloudflare DNS
- Circle Programmable Wallets API key + App ID
- Arc Testnet RPC URL
- Resend API key + verified sender domain
- Cloudflare R2 bucket + access keys

### SSH into the VPS
```
ssh <user>@<vps>
```

### 1. Install Docker + Compose
```
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
exec sudo -u $USER bash -l    # refresh shell
docker --version             # expect 24.x
```

### 2. Clone + env
```
sudo mkdir -p /opt/pazzera && sudo chown $USER /opt/pazzera
cd /opt/pazzera
git clone https://github.com/ruzkypazzy/pazzera.git .
cp .env.example .env
# Edit .env with production values (see Environment section above).
```

### 3. Bring up Postgres + Redis
```
docker compose up -d postgres redis
docker compose ps            # both healthy
```

### 4. Initialize the database
```
docker compose run --rm web pnpm --filter @pazzera/db db:push
# Tables created. (Migrations via db:migrate:dev when schema drifts.)
```

### 5. Build the monolith image
```
docker compose build web
```

### 6. Bring up all services
```
docker compose up -d web realtime workers
docker compose ps
curl http://localhost:3000/ready     # expect { ok: true, ... }
```

### 7. Cloudflare + DNS
- Add an A record `pazzera.com` → `<VPS-IP>` (proxied).
- Add an A record `api.pazzera.com` → `<VPS-IP>` (proxied).
- Enable Cloudflare proxy + Full SSL (strict).

### 8. Nginx + Let's Encrypt
- Install nginx + certbot.
- Add a server block for `pazzera.com` and `api.pazzera.com`.
- `certbot --nginx -d pazzera.com -d api.pazzera.com`
- Reverse-proxy `http://localhost:3000` and `http://localhost:3001` (socket.io).

### 9. Smoke test
```
curl https://pazzera.com/ready
curl https://api.pazzera.com/ready
```

### 10. Admin bootstrap
- Sign up via the UI.
- Set `ADMIN_EMAILS=...` to include that email.
- Restart the workers.
- Visit `/admin` to confirm the role promoted.

### Operational notes
- Logs are JSON-structured via pino. `LOG_LEVEL=info` is sane for prod.
- DB backups: cron `pg_dump` nightly to a private R2 bucket.
- Webhook receiver: `/api/webhooks/circle` (HMAC-SHA256 verified).
- Realtime socket is the only stateful subsystem beyond Postgres;
  it has Redis-backed nonces so a worker crash is recoverable.

## License

UNLICENSED (proprietary).
