# Pazzera

> Pay-per-listen for independent artists, settled in USDC on Arc.

Pazzera is a multi-artist music platform where fans pay a fraction of a cent every time they hit play. No subscriptions, no platform taking 70%, no waiting weeks for a payout — the artist sees the play, the artist gets paid, settled on Arc in under 500ms via x402 and Gateway.

Built for the [Lepton Agents Hackathon](https://lepton.thecanteenapp.com/) (Canteen × Circle, Jun 15 – Jul 6 2026), targeting **RFB 6 — Creator & Publisher Monetization**.

Live: https://pazzera.com (during the build)

---

## What it does

1. **Artist signs up** with email → embedded Circle wallet is created and pre-funded with testnet USDC.
2. **Artist uploads a track** (mp3/wav) → sets a price per listen (default $0.001 USDC).
3. **Fan hits play** → backend asks the fan's embedded wallet to authorize a tiny x402 payment for that track.
4. **Payment settles** on Arc in <500ms, batched with other plays via Gateway.
5. **Artist dashboard** shows real-time plays, USDC earned, top fans.
6. **Multi-artist from day one** — any artist can sign up, onboard their own fans, and start earning.

The agent does the interesting work:
- **Skip-gating** — a 5-second play is free, replays within 30 seconds are free, full listens settle.
- **Dynamic pricing** — the agent raises or lowers price per track based on demand.
- **Payout routing** — per-artist wallets, batched through Gateway.
- **Fraud signal** — flags suspicious plays (same wallet 1000 times in 10 minutes = bot, ignored).

---

## Why this fits the hackathon

| Judging axis | Weight | How Pazzera scores |
|---|---|---|
| Agentic sophistication | 30% | The agent decides when to charge, when to skip, when to reprice, when to route — not just automate |
| Traction | 30% | Built by an indie artist, for indie artists. The artist's own communities (WhatsApp, Telegram, Discord) become day-1 users |
| Circle tool usage | 20% | Wallets (embedded), x402 (HTTP 402 paywall), Gateway (batched nanopayments), USDC native gas, App Kit for future crosschain |
| Innovation | 20% | First per-listen primitive for indie artists on Arc. Canteen's 8 starting points target *self-hosted server operators* — Pazzera targets the *artist directly*, a bigger addressable market |

RFB 6 is the priority lane for this round ("the people the payment floor priced out"), and Pazzera is built there by an actual artist who lives the problem.

---

## Stack

- **Backend**: Node.js + TypeScript + Express, Arc testnet RPC via `@circle-fin/developer-controlled-wallets`
- **Payment rail**: x402 (HTTP 402) → Circle Gateway → USDC on Arc
- **Wallets**: Circle Developer-Controlled Wallets (embedded, no seed phrases, email/Google sign-in)
- **Storage**: tracks on S3-compatible (R2 / Cloudflare R2 free tier during build), metadata in SQLite
- **Frontend**: Vanilla HTML/JS + CSS (no framework), mobile-first
- **Audio**: native HTML5 `<audio>` element with custom controls
- **Hosting**: Cloudflare Pages (frontend) + Fly.io or Railway (backend), DNS via Cloudflare Registrar

---

## Repo structure

```
pazzera/
├── server/          # x402 backend, payment verification, payout routing
├── web/             # player UI, artist signup, artist dashboard
├── docs/            # architecture, API, deployment, submission materials
├── scripts/         # dev helpers, faucet, demo seed
├── assets/          # branding, demo tracks
└── README.md        # you are here
```

---

## Quickstart (developer)

```bash
# 1. Install the Arc CLI (gives you testnet RPC + agent context)
uv tool install git+https://github.com/the-canteen-dev/ARC-cli

# 2. Install the Circle CLI (agent wallets, x402, crosschain USDC)
npm install -g @circle-fin/cli

# 3. Backend
cd server
npm install
cp .env.example .env   # fill in Circle API key + Arc RPC URL
npm run dev

# 4. Frontend (in another shell)
cd web
npm install
npm run dev
```

Open http://localhost:5173 to see the player.

---

## Demo flow (3-minute video script)

1. **Open pazzera.com** → see the artist catalog page
2. **Click an artist** → see their tracks and pricing
3. **Click play** → fan signs in with email (one click, embedded wallet created and funded)
4. **Track plays** → 30 seconds in, $0.001 USDC settles on Arc
5. **Refresh dashboard** → artist sees the play and the payout, in real time
6. **Sign up a second artist** → upload a track → fans can listen and pay
7. **Show the onchain settlement** → open Arc explorer → see the testnet USDC tx

---

## Roadmap (post-hackathon)

- Multi-track albums, smart shuffle
- Tip jar mode (fan-chosen extra payment)
- Revenue splits for collaborators (producer, featured artist)
- Geographic pricing (fans in expensive markets pay slightly more)
- Cash-out via App Kit (Bridge from Arc testnet to a real chain when mainnet flips)
- Native mobile app (after hackathon, when product-market fit is proven)

---

## License

MIT

## Hackathon submission

Built for Lepton Agents Hackathon · Canteen × Circle · 2026