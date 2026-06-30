# Pazzera architecture

> Source-of-truth architecture diagram and data flow map. All `Mermaid`
> blocks render natively on GitHub.

## Monolith deployment

```mermaid
flowchart LR
    User([🎧 Listener]) --> DNS([Cloudflare DNS])
    Artist([🎤 Artist]) --> DNS
    Admin([🛠 Admin]) --> DNS
    DNS --> Nginx([Nginx :443])
    Nginx --> Next([Next.js :3000])
    Nginx --> Socket([Socket.IO :3001])
    Next --> Pg[(Postgres-in-Docker)]
    Socket --> Pg
    Next --> R2[(Cloudflare R2)]
    Socket --> R2
    Next --> Redis[(Redis)]
    Socket --> Redis
    Workers([BullMQ workers]) --> Pg
    Workers --> Redis
    Workers --> R2
    Next --> Workers
    Socket --> Workers
    Next --> Resend([Resend SMTP])
    Workers --> Circle([Circle Gateway facilitator])
    Workers --> Arc([Arc Testnet RPC])
```

## Real-time playback sequence

```mermaid
sequenceDiagram
    autonumber
    participant L as Listener
    participant N as Next.js (apps/web)
    participant S as Socket.IO (packages/realtime)
    participant P as Postgres
    participant W as Fan Agent worker
    participant F as Facilitator service
    participant C as Circle Gateway
    participant A as Arc Testnet

    L->>N: press play
    N->>S: connect (websocket + auth)
    S->>P: lookup session, balance
    S-->>N: emit `joined { thresholdSec, serverTime }`
    loop every 5 s
        L->>N: playback position updates
        N->>S: emit `playback:tick { currentTimeSec, ... }`
        S->>P: upsert PlaybackTick
    end
    Note over S: Server tracker computes server-authoritative effectiveMs
    S->>S: thresholdCrossed = effectiveMs ≥ 25% × duration
    S-->>N: emit `threshold_crossed`
    S->>W: enqueue `agent:fan` (cached signature snapshot)
    W-->>S: emit `payment_due { priceUsdc, nonce, streamId }`
    N->>L: payment due toast appears
    L->>N: confirms (signs x402 envelope)
    N->>S: emit `payment_authorized`
    S->>F: FacilitatorService.settle()
    F->>P: check + consume nonce
    F->>C: POST /v1/x402/settle (TransferWithAuthorization)
    C->>A: submitBatch(USDC.transfer with sig)
    A-->>C: txHash + blockNumber
    C-->>F: { txHash, settledAt }
    F->>P: Payment{status:'settled'} + WalletTransaction
    F->>W: enqueue `agent:split`
    S-->>N: emit `payment_settled`
    N->>L: green checkmark + txHash link
```

## AI agent decision flow

```mermaid
flowchart TD
    Cron([BullMQ cron: every 5 min]) --> Curator([Curator v3])
    Cron --> Fan([Fan v2])
    Cron --> Split([Split v2])
    Cron --> Discovery([Discovery])
    Cron --> Fraud([Fraud Sentinel])
    Curator -- recordDecision --> Log[(AgentDecisionLog)]
    Fan -- recordDecision --> Log
    Split -- recordDecision --> Log
    Discovery -- recordDecision --> Log
    Fraud -- recordDecision --> Log
    Fraud -- severity≥70 --> Freeze[Wallet.status = 'frozen']
    Freeze --> ManualReview[(ManualReview queue)]
    Curator -- approve --> SongUpdate[(Song.curatorStatus='approved')]
    Curator -- reject --> Notify[Notify artist with reasons]
    Curator -- manual_review --> ManualReview
```

## Data model (logical)

```
User ──< Song ──< RoyaltyRecipient ──→  User (internal)  OR  external wallet
User ──1:1── Wallet  ──< WalletTransaction
User ──< Stream ──1:1── Payment ──< Payout ──< LedgerEntry
User ──1:1── SongMetrics / ArtistMetrics / DailyMetrics
Song ──1:1── SongMetrics
User ──< AgentDecisionLog (deterministic, deduplicated by inputHash)
User ──< FraudAlert
Wallet ──< indexerCursor  (Json)
Payment ──1:1── PaymentNonce + PaymentEvent
```

## Strict-typing architecture

```
@types modules (apps/web/types, packages/*/types/)  ← shared .d.ts stubs
                ↓
tsconfig.base.json (strict: true, noUncheckedIndexedAccess: true)
                ↓
per-package tsconfig (extends base, includes cross-package src)
                ↓
CI: pnpm -r typecheck → pnpm -r test → pnpm --filter web test:e2e
```

No per-callback `as any`. No per-package `strict: false`. Every type
boundary flows through a reusable helper under `packages/db/src/utils/`.

## Observability

```
Client → API route (apps/web/app/api/...)
            ↓ assigns correlation ID via X-Request-Id header or mint
            ↓ logger.setBindings({ requestId })
       handler runs
            ↓ emits structured pino logs (service=pazzera)
       Socket.IO server → emits structured pino logs (service=realtime)
            ↓
       CloudWatch / Datadog / Axiom (in production)

Client crash → /api/log/client-error → joins correlation ID
            ↓
       Server-side logger.warn({ kind: 'client_error', ... })
```

## Hardening hot-spots

- `apps/web/lib/realtime-client.ts` — manual retry-with-jitter, six
  `ConnectionStatus` states, explicit `AbortSignal` on backoff,
  `data-connection-status` body attribute for the e2e suite.
- `packages/core/src/middleware/with-api.ts` — correlation-ID
  minting + propagation, request-bound logger bindings.
- `apps/web/components/error-boundary.tsx` — typed `ErrorBoundary`
  with retry / navigation fallback.
- `apps/web/app/error.tsx` — root App Router error UI.
- `apps/web/app/not-found.tsx` — 404 UI.
- `apps/web/app/loading.tsx` — suspense fallback.
- `apps/web/lib/retry.ts` — exponential backoff with jitter.
```
