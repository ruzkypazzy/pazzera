# Pazzera — Architecture

## Overview

Pazzera is a multi-artist music platform where fans pay a fraction of a cent every time they hit play. Artists are paid directly in USDC on Arc testnet, settled via Circle x402 + Gateway.

The system has three components:

1. **Frontend** — Single-page Vite app served from Cloudflare Pages at `pazzera.com`
2. **Backend** — Node.js + Express + TypeScript API at `api.pazzera.com`
3. **Database** — SQLite for dev / Postgres for production (recommended)

## System diagram

```
┌──────────────────┐         ┌──────────────────────┐         ┌──────────────────┐
│  Browser         │         │  Cloudflare           │         │  Railway         │
│  (PWA-ready)     │ ───────▶│  Pages                │         │  (Hobby plan)    │
│                  │  HTTPS  │  • pazzera.com       │         │  • api.pazzera.com│
│  Vanilla JS +    │ ◀────── │  • Edge cache         │ ──────▶ │  • Node 20        │
│  Vite            │         │  • CDN                │  HTTPS  │  • Express 4      │
└──────────────────┘         └──────────────────────┘         └────────┬─────────┘
                                                                       │
                                                                       │ pool 5
                                                                       ▼
                                                              ┌──────────────────┐
                                                              │  SQLite DB        │
                                                              │  /app/data/       │
                                                              │  pazzera.db       │
                                                              │  (ephemeral)      │
                                                              └──────────────────┘
                                                                       │
                                                              ┌────────▼─────────┐
                                                              │  Circle W3S API   │
                                                              │  • /users         │
                                                              │  • /userTokens    │
                                                              │  • /wallets       │
                                                              └──────────────────┘
                                                                       │
                                                              ┌────────▼─────────┐
                                                              │  Arc Testnet RPC  │
                                                              │  • USDC balance   │
                                                              │  • tx receipts    │
                                                              └──────────────────┘
```

## Backend layout

```
server/
├── src/
│   ├── index.ts              # Express app, helmet, CORS, route mounting
│   ├── db.ts                 # SQLite schema + helpers (better-sqlite3)
│   ├── routes/
│   │   ├── auth.ts           # signup, login, logout, me, refresh-circle-token
│   │   ├── account.ts        # GET, PATCH, avatar, change-password, verify-email, delete
│   │   ├── password-reset.ts # forgot-password, reset-password
│   │   ├── tracks.ts         # list, get, upload, edit, delete
│   │   ├── artists.ts        # public catalog, profile detail
│   │   ├── play.ts           # x402 payment flow (start → confirm → settle)
│   │   ├── dashboard.ts      # artist dashboard data
│   │   ├── stats.ts          # platform, artist, track stats
│   │   └── admin.ts          # admin endpoints
│   └── services/
│       ├── auth.ts           # JWT, bcrypt, session middleware
│       ├── circle.ts         # Circle W3S API wrapper
│       ├── crypto.ts         # AES-256-GCM at-rest encryption
│       ├── email.ts          # nodemailer + ethereal.email fallback
│       ├── rate-limit.ts     # per-IP rate limiters
│       ├── audit.ts          # security audit log
│       └── arc.ts            # Arc Testnet RPC (viem)
├── scripts/seed.ts           # (optional) seed demo data
└── tests/                    # vitest
```

## Frontend layout

```
web/
├── index.html                # shell
├── src/
│   ├── main.js               # SPA: router, state, API client, all pages
│   └── styles.css            # dark-mode Spotify-style theme
└── public/
    ├── assets/logo.png       # Pazzera logo (transparent PNG)
    ├── favicon-32.png
    └── favicon-192.png
```

## Data model

```
users ──┬── wallets (1:1, Circle W3S wallet)
        ├── artists (0..1, artist profile)
        ├── tracks (via artists)
        │     └── plays (1:N, listen events)
        ├── sessions (auth audit)
        ├── password_resets (auth audit)
        ├── follows (M:N to artists)
        ├── uploads (avatar/cover/audio)
        └── audit_log (security events)

tracks ──── plays ──── fan_user_id (back to users)
```

Booleans stored as `INTEGER 0/1`. Timestamps stored as `INTEGER` Unix milliseconds. IDs are UUID v4 stored as `TEXT`.

## Authentication flow

```
1. User → POST /api/auth/signup { email, password, displayName, role }
2. Server: bcrypt.hash(password, 12)
3. Server: createUser(email) on Circle W3S
4. Server: createUserToken(email) → userToken, encryptionKey
5. Server: createUserPinWithWallets(userToken, ['ARC-TESTNET'], 'SCA') → challengeId
6. Server: INSERT INTO users + INSERT INTO wallets (with encrypted userToken)
7. Server: signSession({userId, email, role}) → JWT, set httpOnly cookie
8. Browser: store challengeId/userToken/encryptionKey → run Circle Web SDK execute(challengeId)
9. Browser: POST /api/auth/complete-pin-setup → mark wallet.pin_setup_complete = 1
```

Login flow uses bcrypt.compare and the JWT session cookie. Failed logins increment `failed_login_count`; 5 fails in a row = 15-minute lock.

## Payment flow (x402)

```
1. Fan → POST /api/play/start { trackId }
2. Server: skip-gating check (skip if listened < 10s OR replay within 30s)
3. Server: read track.price_per_listen_usdc, read fan.wallet.address
4. Server: create EIP-712 TransferWithAuthorization typed-data challenge
5. Server: respond { playId, typedData, expiresAt }
6. Fan: Circle Web SDK signs the typed data with wallet
7. Fan → POST /api/play/confirm { playId, signature }
8. Server: verify signature (viem.recoverTypedDataAddress)
9. Server: POST to Circle Gateway facilitator /v1/x402/settle
10. Server: insert row in plays (charged, settled=1, settlement_id)
11. Server: increment track.plays_count + earnings_usdc
12. Fan: audio plays
```

Skip-gating means 90% of expected plays are free. Only real listening (10+ seconds, not a replay) costs USDC.

## Production migration: SQLite → Postgres

The Hobby plan on Railway does not include persistent volumes. SQLite at `/app/data/pazzera.db` wipes on every redeploy. For production:

### Recommended: Neon Postgres

1. **Sign up at https://neon.tech** (free tier, 0.5 GB storage)
2. **Create a project** named `pazzera-prod` in region close to Railway (us-west)
3. **Copy the connection string** — looks like:
   ```
   postgresql://user:pass@ep-xxx.us-west-2.aws.neon.tech/neondb?sslmode=require
   ```
4. **Set env vars on Railway**:
   ```
   DB_DRIVER=postgres
   DATABASE_URL=postgresql://user:pass@ep-xxx.us-west-2.aws.neon.tech/neondb?sslmode=require
   ```
5. **Migrate the schema** — Neon runs the same `CREATE TABLE IF NOT EXISTS` statements at boot
6. **Migrate data** (if any) — use `pg_dump` to export SQLite, then load into Postgres. For a hackathon with no real users, just start fresh.

The `db.ts` module is designed to be swappable. A future Postgres adapter would translate `?` placeholders to `$1, $2, ...` and expose the same `prepare/get/all/run/exec` interface as better-sqlite3.

## Security model

| Layer | Mechanism |
|---|---|
| Password | bcryptjs, cost 12 |
| Session | JWT HS256, 7-day expiry, httpOnly + sameSite=lax cookie |
| Account lockout | 5 failed logins → 15-min lock |
| Rate limit | per-IP, 5/hr signup, 10/15min login, 3/hr forgot-password |
| At-rest secrets | AES-256-GCM via ENCRYPTION_KEY (SHA-256 derived) |
| CORS | strict allowlist (no wildcards) |
| Headers | helmet (X-Frame, X-Content-Type, Referrer-Policy, etc.) |
| Password reset | 1-hour single-use tokens, hashed at rest |
| Email verify | 24-hour single-use tokens, hashed at rest |
| 2FA | TOTP (planned, currently stubbed) |
| Audit log | every security-sensitive action recorded |

## Observability

- **Health**: `GET /health` → `{ok:true,service:"pazzera",ts:...}`
- **Readiness**: `GET /ready` → checks DB is reachable
- **Structured logging**: console.log with `[pazzera]` prefix (move to pino in production)
- **Audit log table**: `audit_log` records user_id, action, ip, ua, metadata

For production-grade observability, integrate Sentry (errors) + Axiom or Loki (logs).

## Deployment

```
Push to main → GitHub webhook → Railway auto-rebuild
                              → Cloudflare Pages auto-rebuild
```

Railway Dockerfile: multi-stage build (TypeScript compile + slim runtime). Builds in ~2 min, deploys in ~30s.

Cloudflare Pages: builds on every push via `web/wrangler.toml`. Output: `web/dist`.
