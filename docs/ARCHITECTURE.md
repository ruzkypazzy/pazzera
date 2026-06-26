# Pazzera — Architecture

## High level

```
┌─────────────┐    x402 challenge     ┌──────────────────┐
│   Browser   │ ◄──────────────────►  │   Pazzera API    │
│  (fan)      │    auth + play log    │   (Node/TS)      │
└─────────────┘                        └────────┬─────────┘
                                                │
                                                ▼
                                  ┌──────────────────────────┐
                                  │  Circle W3S              │
                                  │  - create wallet         │
                                  │  - issue EIP-3009 auth   │
                                  │  - submit Gateway batch  │
                                  └────────┬─────────────────┘
                                           │
                                           ▼
                                  ┌──────────────────────────┐
                                  │  Arc testnet (Canteen)   │
                                  │  - USDC native gas       │
                                  │  - <500ms finality       │
                                  └──────────────────────────┘
```

## The play lifecycle

1. **Fan lands on a track page** → enters email (one time) → backend creates a Circle wallet via W3S → backend funds it with 5 testnet USDC from the Canteen faucet.
2. **Fan hits play** → frontend POSTs `/api/play/start` → backend checks replay cooldown, returns:
   - `skip: true` → free play (replay within 30s, or first-time skipped listener)
   - `skip: false` + `challenge` → x402 challenge (payer, payee, amount, nonce, validFor)
3. **Audio plays** → frontend waits for `ended` or `pause` event → captures `listenedSeconds`.
4. **Frontend POSTs `/api/play/confirm`** with:
   - `listenedSeconds`
   - `auth` (signed EIP-3009 authorization from the embedded wallet) — *omitted if `listenedSeconds < skipAfterSeconds`*
5. **Backend**:
   - Verifies auth (EIP-3009 signature recovery)
   - Submits to Gateway batch → settlement tx hash
   - Inserts row in `plays` table
   - Updates `tracks.plays_count` and `tracks.earnings_usdc`

## Skip-gating (the "agent decides" bit)

The agent decides per-listen whether to charge based on:

| Signal | Decision |
|---|---|
| `listenedSeconds < skipAfterSeconds` (default 10s) | Free play, no auth required |
| `now - lastPlay < replayCooldownSeconds` (default 30s) | Free play, return existing play timestamp |
| Else | Charge, require x402 auth, settle |

This is "agentic" because the same logic could be extended to:
- Dynamic price per track based on demand (`price_per_listen_usdc` is already a column)
- Fraud detection: ignore plays from the same wallet > N per minute
- Genre-aware pricing: longer tracks cost more

## Tables

```sql
artists  (id, email, display_name, bio, avatar_url, wallet_id, wallet_address, created_at)
tracks   (id, artist_id, title, description, audio_url, cover_url, duration_seconds,
          price_per_listen_usdc, skip_after_seconds, replay_cooldown_seconds,
          plays_count, earnings_usdc, created_at, published)
plays    (id, track_id, fan_wallet_address, listened_seconds, charged_usdc,
          settled, settlement_tx_hash, skipped, created_at)
```

## API surface

```
GET    /api/tracks                         public catalog
GET    /api/tracks/:id                     track detail
POST   /api/tracks                         artist upload (auth required)
GET    /api/artists/:id                    public artist profile
POST   /api/artists/signup                 create artist + embedded wallet
POST   /api/play/signup                    fan arrives → wallet + faucet
POST   /api/play/start                     start play → x402 challenge
POST   /api/play/confirm                   finish play → settle on Arc
GET    /api/play/recent/:trackId           recent settled plays
POST   /api/wallet/fund                    faucet top-up
GET    /api/dashboard/:artistId            artist earnings + plays
GET    /api/admin/stats                    aggregate stats
```

## x402 in 30 seconds

x402 is the HTTP 402 "Payment Required" status code, used as a payment challenge:

```
HTTP/1.1 402 Payment Required
X-Payment-Address: 0xARTIST...
X-Payment-Amount: 0.001
X-Payment-Token: USDC
X-Payment-Nonce: <uuid>
X-Payment-Valid-Until: <unix-ms>

{
  "challenge": {
    "payer": "0xFAN...",
    "payee": "0xARTIST...",
    "amount": "0.001",
    "resource": "track_id",
    "nonce": "...",
    "validForSeconds": 300
  }
}
```

The client signs an EIP-3009 `transferWithAuthorization` message, sends it back, and the backend submits it (batched with others) via Circle Gateway. Settlement is final in <500ms on Arc.

## Arc specifics

- USDC is the native gas token (no volatile token needed)
- Sub-second finality → instant confirmation in the UI
- EIP-3009 supported on USDC contract → x402 works out of the box
- Canteen hosts a testnet RPC + faucet via the ARC CLI

## Why this scores well

| Judging axis | Evidence |
|---|---|
| Agentic sophistication (30%) | Skip-gate + replay cooldown + dynamic price columns + fraud signal in `plays` |
| Traction (30%) | Multi-artist marketplace, each artist brings their own fans |
| Circle tool usage (20%) | Wallets + x402 + Gateway + USDC + App Kit-ready |
| Innovation (20%) | First per-listen primitive for indie artists on Arc |

## What we'd ship post-hackathon

- Real EIP-3009 signing in the frontend (replace mock signature)
- Native mobile app
- Revenue splits via smart contract (Circle Contracts)
- Cross-chain cash-out via App Kit
- Geographic pricing
- Quadratic funding rounds for emerging artists