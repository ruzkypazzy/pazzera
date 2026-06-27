# Pazzera

> Pay-per-listen for independent artists, settled in USDC on Arc.

Pazzera is a multi-artist music platform where fans pay a fraction of a cent every time they hit play. No subscriptions, no platform taking 70%, no waiting weeks for a payout — the artist sees the play, the artist gets paid, settled on Arc in under 500ms via Circle Gateway + x402.

**Live**: https://pazzera.com
**API**: https://api.pazzera.com
**Built for**: [Lepton Agents Hackathon](https://lepton.thecanteenapp.com/) (Canteen × Circle, Jun 15 – Jul 6 2026), targeting **RFB 6 — Creator & Publisher Monetization**.

## What it does

1. **Artist signs up** with email → Circle W3S provisions a real wallet on Arc Testnet
2. **Artist uploads a track** (mp3/wav URL) → sets a price per listen (default `0.001` USDC)
3. **Fan signs in** with email → Circle W3S provisions their wallet
4. **Fan hits play** → backend issues EIP-712 `TransferWithAuthorization` challenge (x402 standard)
5. **Fan signs** in their wallet → signed typed data returns to browser
6. **Backend verifies** signature, **submits** to Circle Gateway facilitator → settlement UUID
7. **Relayer batches** settlements → on-chain `submitBatch` tx on Arc → payment final in <500ms

The agent does the interesting work:
- **Skip-gating** — listen < 10s is free, replay within 30s is free
- **Dynamic pricing** — `price_per_listen_usdc` per-track column
- **Multi-artist** — each artist has their own wallet, fans pay them directly via Gateway

## Architecture

```
Browser (Vite SPA)
  ↕ HTTPS
Cloudflare Pages + DNS
  ↕ HTTPS
Railway (Node 20 + Express)  ←──→ Circle W3S API (user-controlled wallets)
  ↕                                   ↕
SQLite (dev) / Postgres (prod)    Arc Testnet RPC (USDC balance + receipts)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

## Tech stack

- **Backend**: Node.js 20 + Express + TypeScript + better-sqlite3 (dev) / pg (prod)
- **Frontend**: Vite + vanilla JS + custom CSS (no framework — keeps bundle small)
- **Auth**: JWT sessions + bcryptjs + httpOnly cookies + AES-256-GCM at-rest encryption
- **Wallets**: `@circle-fin/user-controlled-wallets` (server) + `@circle-fin/w3s-pw-web-sdk` (browser)
- **Payments**: Circle x402 EIP-712 typed data + Gateway facilitator
- **Chain**: Arc Testnet (`eip155:5042002`, USDC `0x3600000000000000000000000000000000000000`)
- **Email**: nodemailer with ethereal.email fallback for demo, real SMTP via env vars
- **Security**: helmet + strict CORS allowlist + rate limiting + audit log

## Local development

### Prerequisites

- Node.js 20.18+ (uses `node:` prefix imports and `--no-warnings`)
- npm or pnpm
- (Optional) Circle W3S account for real wallet provisioning
- (Optional) Arc Testnet RPC URL for wallet balance lookups

### Setup

```bash
# Clone
git clone https://github.com/ruzkypazzy/pazzera.git
cd pazzera

# Backend
cd server
cp .env.example .env
# Fill in CIRCLE_API_KEY, CIRCLE_APP_ID, ARC_RPC_URL, JWT_SECRET (generate with `openssl rand -hex 32`),
# ENCRYPTION_KEY (generate with `openssl rand -hex 32`)
npm install
npm run build && npm start

# Frontend (separate terminal)
cd ../web
npm install
npm run dev  # → http://localhost:5173
```

### Running tests

```bash
cd server
npm test         # vitest
npm run typecheck
```

### Database

Default is SQLite at `./pazzera.db`. To use Postgres (recommended for production):

```bash
DB_DRIVER=postgres DATABASE_URL=postgres://... npm start
```

The schema is auto-migrated on boot. See [ARCHITECTURE.md](./ARCHITECTURE.md#production-migration-sqlite--postgres) for the full Postgres migration path.

## Deployment

### Backend on Railway

1. Connect GitHub repo at https://railway.com
2. Auto-detects Dockerfile, builds multi-stage (TS → dist → slim runtime)
3. Set environment variables in **Variables** tab (see `.env.example`)
4. Generate domain at **Settings → Networking → Generate Domain**
5. Add custom domain `api.pazzera.com`

### Frontend on Cloudflare Pages

1. Connect GitHub repo at https://dash.cloudflare.com → Workers & Pages
2. Build command: `cd web && npm install && npm run build`
3. Build output: `web/dist`
4. Add custom domain `pazzera.com`

### DNS

| Type | Name | Target |
|---|---|---|
| CNAME | `@` | `<pages-project>.pages.dev` |
| CNAME | `api` | `<railway-service>.up.railway.app` |

Both with Cloudflare Proxy ON (orange cloud).

## API Reference

### Public endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/ready` | Readiness (DB reachable) |
| GET | `/api/tracks` | List published tracks (`?artistId=` filter) |
| GET | `/api/tracks/:id` | Track detail |
| GET | `/api/artists` | Artist catalog |
| GET | `/api/artists/:id` | Artist profile + their tracks |
| GET | `/api/stats/listening-now` | Active listeners in last 60s |
| GET | `/api/stats/platform` | Platform totals |
| GET | `/api/stats/artist/:id` | Per-artist stats |
| GET | `/api/stats/track/:id` | Per-track stats |

### Auth endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/signup` | Create account + provision Circle wallet |
| POST | `/api/auth/login` | Email + password login |
| POST | `/api/auth/logout` | Clear session cookie |
| GET | `/api/auth/me` | Current user + wallet |
| POST | `/api/auth/forgot-password` | Send reset email |
| POST | `/api/auth/reset-password` | Set new password via token |
| POST | `/api/auth/refresh-circle-token` | Refresh 60min Circle SDK token |
| POST | `/api/auth/complete-pin-setup` | Mark wallet PIN as set |

### Account endpoints (auth required)

| Method | Path | Description |
|---|---|---|
| GET | `/api/account` | Full profile + wallet + balance |
| PATCH | `/api/account` | Update profile fields |
| POST | `/api/account/avatar` | Upload avatar (data URL) |
| POST | `/api/account/change-password` | Change password (current + new) |
| POST | `/api/account/verify-email/send` | Send verification email |
| GET | `/api/account/verify-email` | Verify email via token |
| POST | `/api/account/wallet/refresh-balance` | Re-fetch USDC balance from Arc |
| POST | `/api/account/wallet/complete-pin` | Mark PIN setup complete |
| DELETE | `/api/account` | Delete account (requires password confirm) |

### Artist + tracks (auth required for write)

| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/artist` | Artist dashboard data (KPIs + 14-day chart + tracks) |
| POST | `/api/tracks` | Upload a track |
| PUT | `/api/tracks/:id` | Edit track |
| DELETE | `/api/tracks/:id` | Delete track |

### Play flow (x402)

| Method | Path | Description |
|---|---|---|
| POST | `/api/play/start` | Start play, returns EIP-712 challenge |
| POST | `/api/play/confirm` | Submit signature, backend verifies + submits to Gateway |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | HTTP port (default 3001) |
| `DB_DRIVER` | no | `sqlite` (default) or `postgres` |
| `DB_PATH` | no | SQLite file path (default `./pazzera.db`) |
| `DATABASE_URL` | for postgres | Postgres connection string |
| `JWT_SECRET` | **yes** | Session signing key (32+ bytes hex) |
| `ENCRYPTION_KEY` | **yes** | AES-256-GCM key for at-rest encryption (32+ bytes hex) |
| `CIRCLE_API_KEY` | for real wallets | Circle W3S API key |
| `CIRCLE_APP_ID` | for real wallets | Circle app ID |
| `ARC_RPC_URL` | for balance | Arc Testnet RPC endpoint |
| `PUBLIC_BASE_URL` | for emails | Base URL for email links (e.g. `https://pazzera.com`) |
| `ALLOWED_ORIGINS` | no | Comma-separated CORS origins (default includes pazzera.com + localhost) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | for real email | SMTP credentials (falls back to ethereal.email) |
| `SMTP_FROM` | no | From address (default `Pazzera <noreply@pazzera.com>`) |
| `UPLOADS_DIR` | no | Local upload directory (default `./uploads`) |

Generate secrets with: `openssl rand -hex 32`

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports welcome via GitHub Issues.

## Security

See [SECURITY.md](./SECURITY.md). Report vulnerabilities privately to security@pazzera.com.