# Pazzera

> **The artist-first music streaming protocol.**
> Every stream past the 25% mark fires a USDC nano payment
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

## The problem we set out to solve

A kid in Lagos drops a beat. A producer in São Paulo adds a verse.
A singer in Seoul adds the hook. They upload it to the major
streaming platforms and the math goes like this:

- Spotify pays roughly **$0.003 per stream**.
- The platform takes its cut (~30%).
- The label takes its cut (~50%).
- The aggregator, the distributor, the payment processor — they
  each take a slice.
- The royalty check happens **monthly at best, quarterly at worst**.
- Payouts only fire when you've crossed a **$10–$50 threshold**
  depending on the platform and country.
- You can't see who's listening, where, or how often.
- You can't pay your collaborators without spreadsheets and
  bank transfers.
- If your track isn't a hit, you earn nothing. The platforms don't
  surface unknowns.

So the kid in Lagos makes a song, gets 4,000 streams in a year, and
gets a **$8 royalty payment** to a bank account in a country where
$8 doesn't even cover the cost of the data plan that uploaded the
song. The producer in São Paulo never gets paid at all because they
weren't on the legal entity paperwork. The singer in Seoul waits six
months for the quarterly statement.

**This is the broken status quo for independent music on the
internet.** The platforms make their money from ads and
subscriptions; the artist is a line item in a spreadsheet, paid
last and paid least.

### The people we built Pazzera for

#### Independent artists (the primary users)

**Before Pazzera:**
- Upload a song → wait weeks for review → maybe published, maybe
  rejected with no real feedback
- Earn fractions of a cent per stream, paid months later
- Can't split royalties to collaborators automatically
- Can't see who actually listened
- Pay $10–30/month for "Pro" tools that mostly just gate features
  you already have on a free tier

**With Pazzera:**
- Drop a song + cover → the **PAZZERA BOT** AI agent analyzes the
  audio, captions the cover, suggests title/mood tags/fair rate
  in chat → publish in 60 seconds
- Earn **0.001–0.005 USDC per stream**, paid the moment a listener
  crosses the 25% threshold
- Splits go to collaborators **automatically**, atomically, on-chain
- Every payment is auditable: click a row, see the tx hash, see
  the split breakdown
- No monthly fees. No "Pro" tier. No lock-in.

#### Collaborators (featured artists, producers, songwriters)

**Before Pazzera:**
- You collaborated on a hit, but you signed no paperwork. The
  primary artist uploaded it and you never see a cent.
- Or: you signed paperwork, but it requires chasing the artist
  every quarter for a bank transfer.
- Or: you got paid once, but the song keeps streaming and you don't
  see the ongoing share.

**With Pazzera:**
- Get added as a recipient at upload time, with a `@username` and
  a `splitPercentageBps`. That's it.
- Every stream triggers a smart contract–level split.
- Your wallet gets credited **every time**, forever, for the life
  of the song.
- If you're not on Pazzera yet, the song still credits you in the
  metadata; you can claim your share when you sign up.

#### Listeners

**Before Pazzera:**
- Subscribe to Spotify for $11.99/month, the artist sees $0.002 of
  that per stream.
- Buy an NFT for $200 hoping the artist gets most of it (they don't,
  gas + marketplace cut eats 15–30%).
- Tip via Venmo/CashApp and hope it doesn't bounce.

**With Pazzera:**
- Sign up with email, no card, no KYC for listening.
- Press play. Listen past 25%. **One USDC micro-payment fires** from
  your Circle Gateway balance straight to the artist.
- The cost? Less than a cent. The signal? "I actually care about
  this song enough to pay for it."
- You're not "streaming" in the passive sense. You're
  **micro-tipping** in the active sense, and the cost is invisible
  because Circle Gateway batches it.

#### Labels, distributors, curators (optional intermediaries)

**Before Pazzera:**
- Take 50–70% of streaming revenue in exchange for promotion.
- Artists who don't sign are locked out of the major platforms.

**With Pazzera:**
- Optional: add a label/manager as a credit-only recipient (gets
  the public credit on the song page, but no payout — the artist
  pays them separately, off-platform, however they want).
- Or: add as a paid recipient with a small percentage. Full
  transparency; no hidden take-rate.
- The Curator Agent still reviews uploads for quality. But it
  doesn't gatekeep by industry connections.

### What we believe

1. **The artist should be paid first, paid fast, and paid often.**
2. **Every stream should be a micro-transaction.** A cent is too
   much. A thousandth of a cent is the right number for most
   listeners — and the artists still add up to real income at scale.
3. **Collaborators shouldn't need paperwork to get paid.** A
   username and a percentage is enough.
4. **The platform shouldn't be a gatekeeper.** Curator review is
   for quality, not exclusivity.
5. **AI should handle the boring parts** (metadata, mood tags,
   rate suggestions, royalty splits) **so humans can focus on the
   music.** PAZZERA BOT is the first application of this.
6. **On-chain doesn't mean crypto-bro.** Circle Gateway + x402
   abstracts the wallet so listeners don't see gas, addresses, or
   signing popups. They just sign in with email and listen.

---

## How Pazzera works

When a listener signs in and presses play, here's what happens
under the hood — in plain English:

1. **Sign in** with email + one-time code (Argon2id-hashed at
   rest, Resend-delivered, rate-limited 5/hr).
2. **Discover** music with explainable AI agents (Curator, Fan,
   Split, Discovery, Fraud-Sentinel) — every decision is logged
   for transparency.
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

- Analyzes audio (duration, bitrate, channels, energy, mood from
  ID3 tags) via `music-metadata` + heuristics
- Captions the cover art via GPT-4o vision
- Suggests title, description, mood tags, audio quality, **fair
  per-stream rate (0.001–0.005 USDC, never rejects)** via
  GPT-4o-mini
- Resolves Pazzera `@username` recipients against the DB (with
  fuzzy "did you mean?" if there's a prefix match)
- Drives the LOCKED `/api/songs/create-draft` →
  `/api/upload/{audio,cover,finalize}` pipeline internally
- Returns the new `songId` and confirms "Submitted to Curator ✓"

The bot is a real LLM-backed chatbot: every free-form message goes
through OpenAI with a persona + current upload context. You can ask
"What's a fair rate?", "How does Curator work?", or "Tell me a joke
about producers" — it answers intelligently while still being able
to recognize when you upload files. **It is not a chatbot that
happens to upload. It's an upload tool that happens to chat.** The
conversation is the UI.

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

## The stack, and why each piece matters

This isn't just a tech list — it's a tour through the parts that
make Pazzera possible and what each one does for the user. Pay
special attention to the **Blockchain** and **Payments** sections
if you're coming from a non-crypto background: they're the heart
of the product.

### Frontend: Next.js 14 App Router

**What it is.** Next.js is the React framework that powers the
UI. The "App Router" is its file-system-based routing model —
every folder under `apps/web/app/` is a URL.

**Why it matters here.** Most of Pazzera's pages are partially
**server-rendered** (analytics dashboards, payment timelines,
artist profiles) and partially **client-interactive** (player,
chat with PAZZERA BOT). App Router gives us both in the same
component tree, without the awkwardness of older React setups.
Server actions let the agent commit pipeline stay server-side
without round-tripping through a JSON API.

### Realtime: Socket.IO over WebSocket

**What it is.** A persistent two-way socket between the listener's
browser and our server. The server can push events (a new payment
landed on the artist dashboard) without the client asking.

**Why it matters here.** When a listener crosses 25% on a song,
the listener needs to be told to sign the x402 envelope in the
next ~30 seconds. The artist, watching their dashboard, needs to
see the payment land in real time so they trust the system. Both
sides speak through one Socket.IO connection per session, and
rooms are organized by `userId` and `artistId` so events stay
isolated.

### Database: PostgreSQL 16 + Prisma ORM

**What they are.** Postgres is a relational database with strong
support for JSON columns, partial indexes, and row-level security.
Prisma generates a fully-typed TypeScript client from a schema
file, so every query is type-checked at compile time.

**Why they matter here.** Every royalty split, every payment
record, every agent decision is auditable. We need a database
where you can ask complex questions ("show me every payment to
artist X in the last 7 days, grouped by collaborator, with
average stream length") and get an answer in milliseconds. The
JSON columns on `agent_decisions` and `agent_upload_sessions`
let us store AI reasoning transparently — open the admin panel,
click on a decision, read the full chain of thought.

### Queue: BullMQ on Redis

**What they are.** A job queue system. The web server **enqueues**
work ("analyze this audio file", "generate waveform", "send
notification"); the worker process **dequeues** and runs them,
with retries and backoff if they fail.

**Why it matters here.** Waveform generation takes seconds. Cover
generation runs a vision model. The Curator Agent deliberates.
None of this can run inline on the request that received the
upload — the listener has already closed the tab. So we return
202 immediately and let the workers run in the background, with
state machines to track progress.

### Storage: Cloudflare R2 (S3-compatible)

**What it is.** Object storage with the same API as AWS S3 but
zero egress fees. We use it to store audio files and cover
art. The upload route returns a **presigned URL** — a temporary
URL that lets the browser PUT the file directly to R2, bypassing
our server entirely.

**Why it matters here.** Audio files are 5–20 MB each. Routing
them through our web server would burn bandwidth and CPU on
something the user could do directly. Presigned URLs let us
offload: the browser uploads straight to R2, we just store the
key.

### Auth: Email + one-time code, Argon2id at rest

**How it works.** The user enters their email. We generate a
6-digit code, hash it with Argon2id (a slow, salted, memory-hard
hash designed to resist GPU cracking), and store it in the DB.
We email the plaintext code (via Resend). The user enters it. We
hash what they entered, compare against the DB hash, and on
match issue a session cookie.

**Why it matters here.** There are no passwords to leak. Even if
the DB is dumped, the codes are hashed with a slow algorithm
that makes brute-force impractical. The 10-minute TTL and 5/hr
rate limit shut down credential stuffing.

### Crypto: viem for EIP-712, HKDF for key derivation, AES-256-GCM for at-rest

**What each does.**
- **viem** is a TypeScript library for Ethereum interactions.
  It signs EIP-712 typed-data payloads (`TransferWithAuthorization`)
  in the user's browser wallet or in a server-side wallet provider.
- **HKDF** (HMAC-based Key Derivation Function) lets us derive a
  fresh encryption key from a single master key + a per-user
  salt. So even if one derived key leaks, the master key stays
  safe.
- **AES-256-GCM** is the symmetric encryption we wrap around
  Circle's encrypted wallet tokens and user PII before writing
  them to the database. If the DB is dumped, the secrets are
  still useless without the master key.

**Why it matters here.** Pazzera holds its users' wallet
credentials. That makes us a high-value target. Every secret at
rest is wrapped, every secret in transit is signed.

---

## The blockchain layer (deep dive)

Now the part that makes Pazzera actually different from "yet
another streaming service". Three primitives compose the payment
pipeline: **USDC on Arc Testnet**, **x402** for one-time
authorizations, and **Circle Gateway** for batching & settlement.
Each one is necessary, and removing any of them would break the
product.

### Arc Testnet — the chain

**What it is.** Arc is an EVM-compatible L1 designed for
stablecoin payments. We're on testnet for the Lepton Hackathon
(deadline Jul 6 2026), with mainnet deployment once contracts
are audited.

**Key parameters on testnet:**
- `chainId`: **5042002**
- `rpcUrl`: `https://rpc.testnet.arc-node.thecanteenapp.com/v1/<key>`
- USDC contract: `0x3600000000000000000000000000000000000000`
- USDC decimals: **6** (1 USDC = 1,000,000 micro-units)
- Block time: sub-second finality (~600 ms)

**Why Arc specifically?** Two reasons: (1) Circle's x402
facilitator is wired to Arc testnet out of the box, which means
settlement "just works" without us running our own indexer;
(2) sub-second finality means a payment confirms in <2 seconds
end-to-end, which is what you need when a listener is sitting
on the "this song unlocks now" toast.

**What lives on-chain.** Nothing about Pazzera's media (audio,
cover, metadata) lives on-chain — that's stored in R2 + Postgres.
What lives on-chain is the **payment record**: every `payment_authorized`
event has a corresponding `TransferWithAuthorization` signed by
the listener's wallet, eventually settled by the facilitator.

### x402 — HTTP 402 "Payment Required", done right

**What it is.** x402 is a protocol standard (from the HTTP 402
status code, "Payment Required") that lets a server say "you need
to pay for this resource, here's how". The flow:

1. Client requests a paid endpoint.
2. Server returns **HTTP 402** with an `x402-challenge` header:
   the payment requirements (asset, amount, payTo, facilitator,
   validity window).
3. Client constructs an **EIP-712 `TransferWithAuthorization`**
   payload: "I authorize the facilitator to move N micro-USDC
   from my wallet to the artist's address, valid for 60 seconds,
   with nonce X".
4. Client signs it with their wallet's private key (this happens
   invisibly — for DCW wallets, Circle does it server-side; for
   external wallets, viem does it in the browser).
5. Client retries the request with `x402-payment` header
   containing the signed payload.
6. Server verifies the signature, calls the facilitator, and
   returns 200 with the resource.

**Why it matters here.** x402 gives us **one-shot
authorizations** instead of standing allowances. The listener
does NOT have to approve an unlimited recurring spend on Pazzera.
Every stream past 25% triggers a fresh 60-second signed
authorization. If you stop listening, no more authorizations
fire. If you close the tab, the worst case is one unpaid
attempt for a song you didn't finish.

This is the right primitive for micropayments: cheap to sign
(gasless in practice, since Circle is the facilitator), capped
in amount, single-use.

### Circle Gateway — the settlement layer

**What it is.** Circle Gateway is a service that batches transfers
across Circle-issued stablecoins (USDC for us) using a
**balance-based** model instead of the slow ERC-20 transfer
model. Instead of every payment being a separate on-chain
transaction, Gateway holds a pooled balance per user and
rebalances in bulk.

**Why it matters here.** Two reasons, both structural:

**1. Micropayments need to be CHEAP.** A naive ERC-20 transfer
of 0.002 USDC would cost more in gas than the payment itself.
Gateway abstracts the actual chain movement into batched
settlements, so the listener's wallet doesn't bleed gas on
every song.

**2. Listeners need friction-free top-up.** When a listener signs
up, we deposit a small starting balance to their Circle Gateway
wallet via the testnet faucet. From then on, every payment is
just a balance debit — no on-chain signature on every song.
The wallet calls (deposit, transfer, balance) all go through
Circle's Developer-Controlled Wallets API, which is wrapped in
`@pazzera/blockchain/src/providers/circle-real.ts`.

**Key APIs we use:**
- `POST /v1/wallets/{id}/balances` — fetch USDC + Gateway balance
- `POST /v1/developer/transactions/transfer` — internal Gateway
  transfer between Circle wallets
- `POST /v1/faucet/circle` — testnet faucet drip (claims via
  Circle's tap)
- EIP-712 `signTypedData` — for x402 `TransferWithAuthorization`
  and for Gateway's `BurnIntent` (cross-chain withdrawal to
  external chains)

### How they connect end-to-end

Here's the full payment lifecycle for one stream past 25%:

```
Listener                   Pazzera Web               Fan Agent              Facilitator (Circle)
   |                             |                         |                         |
   |  play() past 25%            |                         |                         |
   |---------------------------->|                         |                         |
   |                             | tick stream + ask "due?"|                         |
   |                             |------------------------>|                         |
   |                             |       payment_due        |                         |
   |                             |<------------------------|                         |
   |                             |                         |                         |
   |       x402 challenge        |                         |                         |
   |<----------------------------|                         |                         |
   |                             |                         |                         |
   |  sign TransferWithAuth      |                         |                         |
   |  (using DCW key, server-side)                         |                         |
   |---------------------------->|                         |                         |
   |                             |  POST /x402/pay         |                         |
   |                             |-------------------------------------------------->|
   |                             |                         |       settle            |
   |                             |<--------------------------------------------------|
   |                             |      txHash + status    |                         |
   |       payment_settled       |                         |                         |
   |<----------------------------|                         |                         |
   |                             |                         |                         |
   |                             |  Split Worker kicks in  |                         |
   |                             |  (fan out to recipients)                         |
   |                             |-------------------------------------------------->|
   |                             |                         |   batch settle          |
```

**Critical invariant**: the listener never sees a signing popup.
Circle DCW wallets sign server-side. The "magic" happens
invisible to the user.

### Why this stack, not Web3-disco-flavor-of-the-month

We picked x402 + Circle Gateway on Arc specifically because:

1. **Stablecoin-native.** No token volatility. 0.002 USDC is
   0.002 USDC tomorrow and next month. Artists price in cents,
   not vibes.
2. **Friction-free top-up.** Circle DCW + testnet faucet means a
   new listener can be paying for streams in 30 seconds, no
   wallet extension needed.
3. **Auditable by default.** Every `TransferWithAuthorization` is
   verifiable on the block explorer. We pin a link in the admin
   dashboard.
4. **Cost-less for the listener.** Gateway batching means the
   listener doesn't bleed gas on a million streams. The
   facilitator absorbs the on-chain cost; we pay them a tiny
   fee.
5. **Composable.** If tomorrow we want to add a "tip the
   producer 5 cents directly" feature, it's the same x402
   primitive — just sign for a different recipient.

### AI Agent: OpenAI gpt-4o-mini + gpt-4o-vision

**Why both models.** `gpt-4o-mini` is cheap and fast for JSON-mode
decisions ("given this audio analysis + cover caption, suggest
title/mood/rate"). `gpt-4o` with vision is the right model for
interpreting cover art ("this is an oil-painted portrait of a
woman at sunset, dominant colors are crimson and gold"). We
use the small model 90% of the time and the big model only for
the cover caption step.

**Why this matters.** PAZZERA BOT isn't a chatbot with an upload
hard-coded — it's a real LLM that understands the audio, the
cover, the artist's intent, and the recipient structure. The
fallback "free chat" path even uses `gpt-4o-mini` for casual
conversation so the agent never feels robotic. OpenAI is the
LLM of choice here because the project's stack (`LLM_API_KEY`,
`LLM_BASE_URL`) is compatible with any OpenAI-compatible
endpoint — you can swap providers without rewriting the
router.

### Workers: tsx + Debian Docker

**Why no build step.** Most TypeScript projects compile `.ts` to
`.js` at deploy time. We use `tsx`, a runtime transpiler, so
the workers run `.ts` files directly. This means a 10-second
deploy instead of a 2-minute one, and no risk of the deployed
`dist/` drifting from the source. The trade-off is slightly
slower startup, but workers are long-lived so amortized cost
is zero.

**Why Debian, not Alpine.** Alpine ships `libssl.so.1.1` but
Prisma's query engine needs `libssl.so.3`. We use the
`node:20-bookworm-slim` base image so `libssl3` is already
installed. Learned this the hard way — the worker container
was silently failing because of this for weeks until the
Hackathon crunch made it impossible to ignore.

### Logs: pino

**Why structured JSON.** Every log line is `{"level":"info",
"msg":"payment_settled","txHash":"0x...","listener":"..."}`
instead of `payment settled 0x... for ...`. This means we can
ship logs to any aggregator (Datadog, Sentry, ELK) without
re-parsing. It also means a `payment_settled` log line is
queryable as an event, not a string.

---

## Strict typing & tests

```
0 TypeScript errors repo-wide · strict mode ON · 91 deterministic tests
```

Every PR runs:
- `pnpm typecheck` — `tsc --noEmit` across all 9 packages
- `pnpm test` — Vitest, unit + integration, in-memory SQLite
- `pnpm test:e2e` — Playwright, real browser, real backend

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