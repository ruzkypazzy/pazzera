# Pazzera — Deployment

## Local dev

```bash
# 1. Arc CLI (testnet RPC + agent context)
uv tool install git+https://github.com/the-canteen-dev/ARC-cli

# 2. Circle CLI (wallets, x402, crosschain USDC)
npm install -g @circle-fin/cli

# 3. Backend
cd server
npm install
cp .env.example .env  # fill in Circle API key + Arc RPC
npm run dev           # http://localhost:3001

# 4. Frontend (separate shell)
cd web
npm install
npm run dev           # http://localhost:5173
```

Optional seed for the demo:
```bash
cd server && npm run seed
```

## Environment variables

| Var | Where | Notes |
|---|---|---|
| `CIRCLE_API_KEY` | server | from Circle developer dashboard |
| `CIRCLE_ENTITY_SECRET` | server | required for wallet creation |
| `CIRCLE_WALLET_SET_ID` | server | the wallet set that holds artist + fan wallets |
| `ARC_RPC_URL` | server | Canteen-hosted Arc testnet RPC |
| `ARC_CHAIN_ID` | server | 5042001 (testnet) |
| `ARC_USDC_CONTRACT` | server | USDC contract on Arc |
| `ARC_GATEWAY_CONTRACT` | server | Circle Gateway contract on Arc |
| `FAUCET_URL` | server | Canteen-hosted testnet USDC faucet |
| `PUBLIC_BASE_URL` | web | where the frontend runs |
| `API_BASE_URL` | web | where the backend runs |
| `JWT_SECRET` | server | for artist auth cookies (post-MVP) |
| `PLATFORM_FEE_BPS` | server | 0 = no platform fee |

## Production (post-hackathon)

For the hackathon submission, deploy on any free tier:

- **Backend**: Fly.io free tier, Railway, or Render
- **Frontend**: Cloudflare Pages (free, global CDN, custom domain)
- **Storage**: Cloudflare R2 (free egress)
- **DNS**: Cloudflare Registrar (where pazzera.com already lives)

### One-time setup

1. Point `pazzera.com` to Cloudflare (already done if you bought there)
2. Deploy backend, get a public URL
3. Set `PUBLIC_BASE_URL` and `API_BASE_URL` to the deployed URLs
4. Deploy frontend with env vars set

## Demo checklist (day of submission)

- [ ] `pazzera.com` resolves
- [ ] Landing page shows at least 1 track
- [ ] Hit play → email modal → wallet created → song plays
- [ ] 30s in → toast shows settlement + tx hash
- [ ] Dashboard shows the play and earnings updated
- [ ] Sign up a second artist, upload a second track, fans can play it
- [ ] 3-min video recorded and uploaded to YouTube/Loom/Vimeo
- [ ] README, ARCHITECTURE.md, DEPLOYMENT.md all present
- [ ] `npm test` passes
- [ ] GitHub repo is public
- [ ] Submission form filled out at https://forms.gle/SMqLaw2pMGDe58LFA