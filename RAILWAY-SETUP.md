# Railway Environment Variables Setup

Go to your Railway service → **Variables** tab and set these:

## Required (signup will fail without these)

| Variable | Value |
|----------|-------|
| `CIRCLE_API_KEY` | `TEST_API_KEY:4dc024ac4c7250c43cf4f2410727140c:76ae77d391cb937ee5e8bf185842b796` |
| `CIRCLE_ENTITY_SECRET` | `475ae5b70a2f15b8ae28bfec9a4c437cf4c6643b0eebf27b06b45653d6f9062a` |
| `CIRCLE_WALLET_SET_ID` | `622c08e4-6295-5ed2-a0ad-ababff77a02f` |
| `JWT_SECRET` | run `openssl rand -hex 32` and paste result |
| `ENCRYPTION_KEY` | run `openssl rand -hex 32` and paste result |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | `https://pazzera.com` |
| `ALLOWED_ORIGINS` | `https://pazzera.com,https://www.pazzera.com` |

## Get CIRCLE_APP_ID
1. Go to https://console.circle.com
2. Your app → **User Controlled Wallets** (or Configurator)  
3. Copy the App ID — looks like `a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
4. Add as `CIRCLE_APP_ID` on Railway

## Optional but recommended
| Variable | Value |
|----------|-------|
| `ARC_RPC_URL` | `https://rpc.testnet.arc.network` |
| `ARC_CHAIN_ID` | `5042002` |
| `DB_PATH` | `./pazzera.db` |

## After setting vars
Railway will auto-redeploy. Then test:
- `https://api.pazzera.com/health` → `{"ok":true}`
- `https://api.pazzera.com/api/debug/env` → all booleans should be `true`
- Try signup at `https://pazzera.com/signup`
