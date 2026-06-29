# Pazzera

Decentralized pay-per-listen music streaming on **Arc Testnet** with **USDC** nano payments via the **x402** protocol and **Circle Gateway**.

**No subscriptions. No gatekeepers. No platform fees.** Direct artist payouts.

---

## Architecture

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full system design: module boundaries, event flows, env schema, dependency reasoning, and risk register.

Short version:

```
Next.js web (apps/web) ─► API routes ─► Prisma ─► PostgreSQL 16 (Docker)
                            │
                            ├─► Redis (BullMQ queues, rate-limit)
                            ├─► Socket.IO gateway (separate process :3001)
                            ├─► BullMQ workers (curator / fan / split)
                            └─► Arc RPC + Circle Gateway facilitator + Cloudflare R2
```

---

## Quick start (local dev)

```bash
# 1. Install pnpm if you don't have it
corepack enable && corepack prepare pnpm@9.6.0 --activate

# 2. Copy env template and fill in real values
cp .env.example .env

# 3. Start Postgres + Redis in Docker
docker compose up -d postgres redis

# 4. Install deps
pnpm install

# 5. Generate Prisma client + push schema
pnpm db:generate
pnpm db:push

# 6. Start web (Next.js) + socket gateway + workers
pnpm dev          # web
pnpm socket       # socket gateway :3001 (separate terminal)
pnpm worker       # agent workers (separate terminal)
```

Web: http://localhost:3000
Socket: ws://localhost:3001

---

## Production (Contabo VPS)

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — covers Docker, Nginx, Let's Encrypt, Cloudflare DNS, backups, rollback.

---

## Phase 1 deliverables

- [x] **Architecture diagram + folder structure** — `docs/ARCHITECTURE.md` §1, §3
- [x] **Module boundaries** — `docs/ARCHITECTURE.md` §2
- [x] **Event-flow diagrams** — `docs/ARCHITECTURE.md` §4, §5, §6
- [x] **Environment variable schema** — `docs/ARCHITECTURE.md` §8 + `.env.example`
- [x] **Dependency list with reasoning** — `docs/ARCHITECTURE.md` §9
- [x] **Prisma schema preview** — `packages/db/prisma/schema.prisma` (full schema + migrations land in Phase 2)
- [x] **Docker stack** — `docker-compose.yml`, `docker/Dockerfile.web`, `docker/Dockerfile.worker`, `docker/nginx.conf`
- [x] **Backup / restore / healthcheck scripts** — `scripts/`
- [x] **CI workflow** — `.github/workflows/ci.yml`

---

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Architecture & scaffolding | ✅ done |
| 2 | Database schema + migrations | ⏳ |
| 3 | Auth (Resend OTP, sessions) | ⏳ |
| 4 | Wallet creation + encryption | ⏳ |
| 5 | Frontend UI | ⏳ |
| 6 | Upload pipeline (R2, metadata) | ⏳ |
| 7 | AI agents (Curator / Fan / Split) | ⏳ |
| 8 | Streaming engine (Socket.IO) | ⏳ |
| 9 | Nano payment (Arc + x402 + Circle) | ⏳ |
| 10 | Tests (Vitest + Playwright) | ⏳ |
| 11 | Deployment (Contabo + DNS + SSL) | ⏳ |

---

## License

UNLICENSED — proprietary.