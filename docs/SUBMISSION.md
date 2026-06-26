# Pazzera — Submission materials

## Hackathon
**Lepton Agents Hackathon** — Canteen × Circle, Jun 15 – Jul 6 2026

## Track
RFB 6 — Creator & Publisher Monetization

## Tagline
> Pay per listen. Every play moves USDC on Arc in under 500ms.

## One-paragraph pitch

Pazzera is a per-listen payment app for independent music artists. Fans sign in with email — no seed phrases, no MetaMask — and a Circle embedded wallet is created and pre-funded with testnet USDC. When they hit play on a track, the backend issues an x402 challenge, the embedded wallet signs an EIP-3009 authorization, and the payment settles on Arc via Circle Gateway in under 500ms. Skip in the first 10 seconds, or replay within 30 seconds, and it's free. The agent decides when to charge and when to free-play, per track. Multi-artist from day one — anyone can sign up, set their price, and start earning. Built by an indie artist for indie artists, in Canteen's priority lane for this round.

## Submission form fields

- **Project name**: Pazzera
- **Tagline**: Pay-per-listen for indie artists on Arc
- **Public repo**: https://github.com/ruzkypazzy/pazzera
- **Live link**: https://pazzera.com
- **Video demo**: [paste YouTube/Loom URL once recorded]
- **RFB**: RFB 6 — Creator & Publisher Monetization
- **Stack**: Node/TS backend, vanilla JS frontend, Circle W3S, x402, Arc, USDC
- **Track length**: keep demo video under 3 minutes

## 3-minute video script

1. **(0:00–0:20)** Open on `pazzera.com`. "This is Pazzera — a per-listen payment app for independent artists, settled in USDC on Arc."
2. **(0:20–0:50)** Show the catalog. "Three tracks from two artists. Each one priced at a fraction of a cent per listen."
3. **(0:50–1:30)** Click a track → enter email → wallet created and funded → song plays. "No MetaMask. No seed phrase. Email creates a Circle embedded wallet, pre-funded from the Canteen faucet."
4. **(1:30–2:00)** Let the track play 30+ seconds → toast shows settlement + tx hash. "The agent decided the fan listened long enough, signed an x402 authorization, and the payment settled on Arc in under 500ms."
5. **(2:00–2:30)** Switch to artist dashboard → show plays count update, earnings appear, recent settled plays with tx hashes. "The artist sees it in real time."
6. **(2:30–3:00)** Show the second artist's page → upload a new track from the dashboard → end on the catalog. "Multi-artist from day one. Anyone can sign up, anyone can earn."

## Traction questions the form will ask

- **How many users have you onboarded?**: count of distinct fan wallets created during the build window + your communities
- **What user problems are you building for?**: the 70% platform cut, the 2–3 month payout delay, the $0.003 per-stream floor that makes indie music unviable

## Press / social

- Telegram: @OnisowoBot (existing community, post about it there)
- Discord: your existing community + the Lepton Discord `#lepton-builders`
- WhatsApp: your existing community
- X / Twitter: post the demo video, tag @circle, @cantobuilders

## Judging alignment

- 30% Agentic: skip-gate, replay cooldown, dynamic pricing column, fraud signal logic
- 30% Traction: multi-artist marketplace, your communities + indie network
- 20% Circle tools: Wallets + x402 + Gateway + USDC + App Kit-ready
- 20% Innovation: first per-listen primitive for indie artists on Arc

## Post-hackathon

If you ship this and judges want to keep backing you: roadmap in README covers multi-track albums, smart shuffle, tip jar, revenue splits, geographic pricing, cross-chain cash-out, native mobile. The product is real — the hackathon just gives us the runway to ship v1.