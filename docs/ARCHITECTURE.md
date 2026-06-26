# Pazzera — Architecture

## High level

```
┌─────────────────┐  email OTP   ┌────────────────────┐
│   Fan browser   │ ◄──────────► │  Circle Web SDK    │
│  (vanilla JS)   │              │  (w3s-pw-web-sdk)  │
└────────┬────────┘              └──────────┬─────────┘
         │ EIP-712 sig                       │
         │                                   ▼
         │                          ┌──────────────────┐
         │                          │  Circle W3S API  │
         │                          │  (user/wallet    │
         │                          │   challenges)    │
         │                          └────────┬─────────┘
         │                                   │
         │                                   ▼
         │ x402 challenge + signed EIP-712  ┌──────────────────────┐
         │ ◄───────────────────────────────►│  Pazzera backend    │
         │                                   │  (Node/Express)     │
         │                                   └────────┬─────────────┘
         │                                            │
         │                                            │ POST /v1/x402/settle
         │                                            ▼
         │                                   ┌──────────────────────┐
         │                                   │  Circle Gateway      │
         │                                   │  facilitator (testnet)│
         │                                   └────────┬─────────────┘
         │                                            │
         │                                            │ submitBatch()
         │                                            ▼
         │                                   ┌──────────────────────┐
         │                                   │  Arc Testnet         │
         │                                   │  GatewayWallet       │
         │                                   │  eip155:5042002      │
         │                                   │  <500ms finality     │
         │                                   └──────────────────────┘
         │
         ▼
   (audio plays in browser while settlement queues)
```

## The play lifecycle (real flow)

1. **Fan lands** → clicks play on a track card.
2. **Fan enters email** (modal) → frontend `POST /api/play/signup` → backend calls `circle.createUser({ userId: email })` → returns.
3. **Backend calls `circle.createWallet({ userId, blockchains: ['ARC-TESTNET'] })`** → returns `{ walletId, address }`.
4. **Backend returns wallet to frontend** → fan funds it at https://faucet.circle.com (one click, ~5 testnet USDC).
5. **Frontend calls `POST /api/play/start`** → backend checks replay cooldown, returns either `skip: true` (free) or `skip: false` + an x402 challenge.
6. **The x402 challenge** is a fully-formed EIP-712 `TransferWithAuthorization` typed-data payload:
   ```js
   {
     domain: { name: 'USDC', version: '2', chainId: 5042002, verifyingContract: USDC_ADDR },
     types: { TransferWithAuthorization: [...] },
     primaryType: 'TransferWithAuthorization',
     message: { from, to, value, validAfter, validBefore, nonce }
   }
   ```
7. **Browser audio plays** the track (instant — the user doesn't wait for signing).
8. **Frontend signs the typed data**:
   - **Path A**: Circle Web SDK creates a "sign" challenge on the backend, frontend calls `sdk.execute(challengeId)`, hosted UI pops up, user approves, SDK returns signature.
   - **Path B**: `window.ethereum.request({ method: 'eth_signTypedData_v4', params: [account, JSON] })`.
9. **Audio ends** (or user pauses after 10s) → frontend `POST /api/play/confirm` with `{ trackId, fanEmail, listenedSeconds, auth: { payer, payee, value, validAfter, validBefore, nonce, signature } }`.
10. **Backend verifies**:
    ```ts
    const recovered = await recoverTypedDataAddress({ domain, types, message, signature });
    if (recovered.toLowerCase() !== auth.payer.toLowerCase()) return 402;
    ```
11. **Backend submits** to Gateway facilitator:
    ```ts
    POST https://gateway-api-testnet.circle.com/v1/x402/settle
    { network, authorization, signature }
    ```
    → returns `{ transferId }` (settlement UUID).
12. **Backend records** the play in SQLite with `settlementId` (real UUID), increments plays + earnings.
13. **Frontend polls** `GET /api/play/settlement/:id` every 2s → once `status === 'completed'`, response includes `batchTx` (on-chain `submitBatch` hash).
14. **Frontend opens** `https://testnet.arcscan.app/tx/<batchTx>` for the user to see the on-chain proof.

## Skip-gating (the "agent decides")

| Signal | Decision |
|---|---|
| `listenedSeconds < skip_after_seconds` (default 10s) | Free play, no signature required, no on-chain tx |
| `now - lastPlay < replay_cooldown_seconds` (default 30s) | Free play (replay protection) |
| Else | EIP-712 signature required, submit to Gateway |

This is "agentic" because the same logic extends to:
- Dynamic pricing per track (`price_per_listen_usdc` column)
- Fraud signal: ignore plays from the same wallet > N per minute
- Genre-aware pricing: longer tracks cost more

## Database schema

```sql
artists  (id, email, display_name, bio, avatar_url, wallet_id, wallet_address, created_at)
tracks   (id, artist_id, title, description, audio_url, cover_url, duration_seconds,
          price_per_listen_usdc, skip_after_seconds, replay_cooldown_seconds,
          plays_count, earnings_usdc, created_at, published)
plays    (id, track_id, fan_wallet_address, listened_seconds, charged_usdc,
          settled, settlement_tx_hash, skipped, created_at)
```

`settlement_tx_hash` stores the real Gateway settlement UUID (not an on-chain tx hash until the batch settles — that hash comes from polling `/api/play/settlement/:id`).

## API surface

```
GET    /api/tracks                          public catalog
GET    /api/tracks/:id                      track detail
POST   /api/tracks                          artist upload (auth required)
GET    /api/artists/:id                     public artist profile
POST   /api/artists/signup                  artist signup + wallet
POST   /api/play/signup                     fan wallet + faucet nudge
POST   /api/play/start                      start play → x402 challenge
POST   /api/play/confirm                    finish play → verify + submit
POST   /api/play/sign-challenge             Circle SDK sign challenge
GET    /api/play/settlement/:id             poll settlement → on-chain batch tx
GET    /api/play/recent/:trackId            recent settled plays
POST   /api/wallet/fund                     faucet top-up
GET    /api/dashboard/:artistId             artist earnings + plays
GET    /api/admin/stats                     aggregate stats
```

## EIP-712 `TransferWithAuthorization` (USDC standard)

This is the same typed-data payload USDC V2 uses everywhere — Circle's Gateway infrastructure recovers it directly. The frontend wallet produces the signature, the backend verifies it (off-chain, gas-free) and submits the authorization to the facilitator (which batches it into one on-chain `submitBatch` tx).

```ts
const EIP712_DOMAIN = {
  name: 'USDC',
  version: '2',
  chainId: 5042002,
  verifyingContract: '0x3600000000000000000000000000000000000000',
};

const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
};
```

## Why this scores well

| Axis | Evidence |
|---|---|
| Agentic (30%) | Skip-gate + replay cooldown + EIP-712 verify + Gateway submit — all server-side decisions |
| Traction (30%) | Multi-artist, your communities, real payments flowing on Arc testnet |
| Circle tools (20%) | W3S User-Controlled Wallets + Web SDK + x402 facilitator + Gateway + USDC — full stack |
| Innovation (20%) | First per-listen primitive for indie artists on Arc; Canteen's 8 starting points target a different audience |

## What we'd ship post-hackathon

- Real revenue splits via Circle Contracts (`@circle-fin/contracts`) — split a $0.001 listen between artist + producer + featured artist
- Cash-out via App Kit Bridge — artist withdraws Arc testnet → real chain USDC
- Geographic pricing
- Native mobile app
- Quadratic funding rounds for emerging artists