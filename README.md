# Pazzera

> Pay-per-listen for independent artists, settled in USDC on Arc.

Pazzera is a multi-artist music platform where fans pay a fraction of a cent every time they hit play. No subscriptions, no platform taking 70%, no waiting weeks for a payout — the artist sees the play, the artist gets paid, settled on Arc in under 500ms via Circle Gateway + x402.

Built for the [Lepton Agents Hackathon](https://lepton.thecanteenapp.com/) (Canteen × Circle, Jun 15 – Jul 6 2026), targeting **RFB 6 — Creator & Publisher Monetization**.

**Live**: https://pazzera.com

---

## What it does

1. **Artist signs up** with email → Circle W3S provisions a real wallet on Arc Testnet (`eip155:5042002`).
2. **Artist uploads a track** (mp3/wav URL) → sets a price per listen (default `0.001` USDC, configurable).
3. **Fan signs in** with email → Circle W3S provisions their wallet, the SDK runs in-browser to authenticate via email OTP.
4. **Fan hits play** → backend issues an EIP-712 `TransferWithAuthorization` challenge (the x402 standard).
5. **Fan signs** in their wallet's hosted UI (Circle Web SDK) → signed EIP-712 typed data returns to the browser.
6. **Backend verifies** the signature, **submits** to the Circle Gateway facilitator → settlement UUID returned.
7. **Relayer batches** many settlements → one on-chain `submitBatch` tx on Arc → payment final in <500ms.

The agent does the interesting work:
- **Skip-gating** — listen < 10s is free (no signature), replay within 30s is free.
- **Dynamic pricing** — `price_per_listen_usdc` is a column; the agent can reprice per-track based on demand.
- **Multi-artist** — every artist has their own wallet, fans' payments route directly to them via Gateway's `payee` field.

---

## Why this fits the hackathon

| Judging axis | Weight | How Pazzera scores |
|---|---|---|
| Agentic sophistication | 30% | The agent decides when to charge (skip + replay), validates EIP-712 signatures, submits to Gateway |
| Traction | 30% | Built by an indie artist, for indie artists. Built-in distribution via artist communities (WhatsApp/Telegram/Discord) |
| Circle tool usage | 20% | W3S User-Controlled Wallets + x402 + Gateway facilitator + USDC on Arc — every Circle primitive in the stack |
| Innovation | 20% | First per-listen primitive for indie artists on Arc. Canteen's 8 starting points target self-hosted server operators — Pazzera targets the artist directly, a bigger addressable market |

RFB 6 is the priority lane this round ("the people the payment floor priced out"). Pazzera is built there by an actual artist who lives the problem.

---

## Stack

- **Backend**: Node.js + TypeScript + Express
- **Database**: SQLite (better-sqlite3)
- **Wallets**: `@circle-fin/user-controlled-wallets` (server) + `@circle-fin/w3s-pw-web-sdk` (browser)
- **Payments**: Circle Gateway facilitator (`@circle-fin/x402-batching` middleware + raw `/v1/x402/settle`)
- **Chain**: Arc Testnet (chain ID `5042002`, USDC at `0x3600…0000`)
- **EIP-712**: `TransferWithAuthorization` typed-data (USDC V2 standard)
- **Frontend**: Vanilla JS + Vite + Vite Node Polyfills (for Circle Web SDK)
- **Real verification**: `viem`'s `recoverTypedDataAddress` — no mock signature checks

## Network details (Arc Testnet)

| Field | Value |
|---|---|
| Network | Arc Testnet |
| Chain ID | `5042002` (`0x4CEF52`) |
| RPC | `https://rpc.testnet.arc-node.thecanteenapp.com/v1/<your-key>` (Canteen-personalized, get via `arc-canteen rpc-url`) |
| Public RPC | `https://rpc.testnet.arc.network` |
| Explorer | https://testnet.arcscan.app |
| USDC | `0x3600000000000000000000000000000000000000` (6 decimals) |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| CCTP Domain | `26` |
| Faucet | https://faucet.circle.com |

## Repo structure

```
pazzera/
├── server/
│   ├── src/
│   │   ├── index.ts            Express app
│   │   ├── db.ts               SQLite schema
│   │   ├── services/
│   │   │   └── circle.ts       Circle W3S + Gateway + x402 verify/send
│   │   └── routes/
│   │       ├── artists.ts      signup + profile
│   │       ├── tracks.ts       catalog + upload
│   │       ├── play.ts         x402 play flow
│   │       ├── wallet.ts       faucet
│   │       ├── dashboard.ts    artist earnings
│   │       ├── admin.ts        aggregate stats
│   │       └── sign.ts         Circle SDK sign challenge
│   ├── scripts/
│   │   ├── fund.ts             fund a wallet via faucet
│   │   └── seed.ts             demo data seeder
│   ├── tests/
│   │   └── basic.test.ts
│   ├── package.json
│   └── tsconfig.json
├── web/
│   ├── index.html
│   ├── app.js                  player UI + Circle SDK + MetaMask fallback
│   ├── styles.css
│   └── package.json
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── SUBMISSION.md
└── README.md
```

## Quickstart

```bash
# 1. Install Canteen's Arc CLI (gives you a personalized RPC URL + testnet access)
uv tool install git+https://github.com/the-canteen-dev/ARC-cli.git
arc-canteen login
arc-canteen rpc-url --export   # add this to your shell, or paste into .env

# 2. Get a Circle API key + App ID from https://console.circle.com
#    - Enable Wallets > User Controlled > Configurator
#    - Configure Sign Typed Data (required for the x402 signing challenge)
#    - Note your CIRCLE_API_KEY and CIRCLE_APP_ID

# 3. Backend
cd server
npm install
cp .env.example .env   # paste CIRCLE_API_KEY, CIRCLE_APP_ID, ARC_RPC_URL
npm run dev            # http://localhost:3001

# 4. Frontend (separate shell)
cd web
npm install
# Create web/.env with VITE_PAZZERA_API and VITE_PAZZERA_APP_ID
npm run dev            # http://localhost:5173
```

## Environment variables

| Var | Where | Source |
|---|---|---|
| `CIRCLE_API_KEY` | server | https://console.circle.com |
| `CIRCLE_APP_ID` | web (injected as `window.PAZZERA_APP_ID`) | same |
| `ARC_RPC_URL` | server | `arc-canteen rpc-url` |
| `ARC_CHAIN_ID` | server | `5042002` (hardcoded) |
| `ARC_USDC_CONTRACT` | server | `0x3600000000000000000000000000000000000000` |
| `GATEWAY_WALLET` | server | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| `FACILITATOR_URL` | server | `https://gateway-api-testnet.circle.com` |
| `NETWORK_ID` | server | `eip155:5042002` |
| `FAUCET_URL` | server | `https://faucet.circle.com` |

## Demo flow

1. Open `pazzera.com` → see catalog (3 demo tracks from 2 artists).
2. Click a track → enter email → Circle Web SDK creates a wallet (testnet).
3. Hit play → SDK shows OTP modal → enter OTP → wallet created.
4. Fund at https://faucet.circle.com (one click, ~5 testnet USDC).
5. Hit play again → backend issues x402 EIP-712 challenge.
6. Wallet signs the typed data → frontend POSTs signature.
7. Backend verifies signature, submits to Gateway → settlement UUID.
8. Relayer batches → on-chain `submitBatch` tx → <500ms finality.
9. Toast: "✓ Paid $0.001 to [Artist] · settlement abc…".
10. Polling opens testnet.arcscan.app with the batch tx.

## Demo checklist

- [ ] `arc-canteen login` and paste the RPC URL into `.env`
- [ ] Set `CIRCLE_API_KEY` + `CIRCLE_APP_ID` from console.circle.com
- [ ] `npm run seed` for demo data
- [ ] Fund your own wallet via `npm run fund -- 0xYourAddress`
- [ ] Open `localhost:5173`, walk through the play flow
- [ ] Capture a 3-min demo video (script in `docs/SUBMISSION.md`)
- [ ] Submit at https://forms.gle/SMqLaw2pMGDe58LFA

## License

MIT

## Hackathon

Built for Lepton Agents Hackathon · Canteen × Circle · 2026