# Pazzera — Submission materials

## Hackathon
**Lepton Agents Hackathon** — Canteen × Circle, Jun 15 – Jul 6 2026

## Track
RFB 6 — Creator & Publisher Monetization

## Tagline
> Pay per listen. Every play moves USDC on Arc in under 500ms.

## One-paragraph pitch

Pazzera is a per-listen payment app for independent music artists. Fans sign in with email — Circle W3S creates an embedded wallet on Arc Testnet, pre-funded from Circle's faucet. When they hit play, the backend issues an x402 EIP-712 challenge (TransferWithAuthorization), the wallet signs, the backend verifies with viem and submits to the Circle Gateway facilitator. The relayer batches many settlements into one on-chain `submitBatch` tx on Arc, final in <500ms. Skip in the first 10 seconds, or replay within 30 seconds, and it's free. The agent decides when to charge. Multi-artist from day one. Built by an indie artist for indie artists, in Canteen's priority lane for this round.

## Submission form fields

- **Project name**: Pazzera
- **Tagline**: Pay-per-listen for indie artists on Arc
- **Public repo**: https://github.com/ruzkypazzy/pazzera
- **Live link**: https://pazzera.com
- **Video demo**: [paste YouTube/Loom URL once recorded]
- **RFB**: RFB 6 — Creator & Publisher Monetization
- **Stack**: Node/TS backend, vanilla JS frontend, Circle W3S, x402 + Gateway, USDC on Arc

## 3-minute video script

1. **(0:00–0:20)** Open `pazzera.com`. "This is Pazzera — a per-listen payment app for independent artists, settled in USDC on Arc via Circle Gateway and x402."
2. **(0:20–0:50)** Show the catalog. "Three tracks from two artists, priced at fractions of a cent per listen."
3. **(0:50–1:30)** Click a track → email modal → Circle Web SDK opens hosted UI → wallet created on Arc Testnet. "No MetaMask, no seed phrases — email authentication via Circle's Web SDK."
4. **(1:30–2:00)** Fund at faucet.circle.com → re-hit play → EIP-712 challenge appears. Show the typed data structure.
5. **(2:00–2:30)** Wallet signs the typed data → audio plays → 30 seconds in, settlement toast appears. "The backend verified the signature, submitted to Circle Gateway, and the relayer batched it. Total time: under 500ms."
6. **(2:30–2:50)** Switch to artist dashboard → plays count updated, earnings appear, recent settlements with the on-chain tx hash link to testnet.arcscan.app.
7. **(2:50–3:00)** End on the live stats page. "Multi-artist from day one. Anyone can sign up, anyone can earn."

## Traction questions the form will ask

- **How many users have you onboarded?**: count of distinct Circle wallets created during the build window + your communities
- **What user problems are you building for?**: the 70% platform cut, the 2–3 month payout delay, the $0.003 per-stream floor that makes indie music unviable

## Press / social

- Telegram: @OnisowoBot (existing community, post about it)
- Discord: existing community + Lepton `#lepton-builders`
- WhatsApp: existing community
- X: post the demo video, tag @circle, @thecanteen

## Judging alignment

- 30% Agentic: skip-gate, replay cooldown, EIP-712 verify, Gateway submit
- 30% Traction: multi-artist marketplace, your communities + indie network
- 20% Circle tools: W3S + Web SDK + x402 + Gateway + USDC — full stack
- 20% Innovation: first per-listen primitive for indie artists on Arc