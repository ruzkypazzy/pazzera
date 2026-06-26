# Pazzera — Railway deployment

Railway auto-detects the Dockerfile at repo root. To deploy:

1. **Push to GitHub**: `git push origin main` (already done — see `ruzkypazzy/pazzera`)
2. **In Railway dashboard** (railway.com):
   - Click **New Project** → **Deploy from GitHub repo**
   - Select `ruzkypazzy/pazzera`
   - Railway auto-detects the Dockerfile, builds it
   - Service gets a `*.up.railway.app` URL with auto-HTTPS
3. **Set environment variables** in Railway → Variables tab:
   - `CIRCLE_API_KEY` (your 78-char TEST_API_KEY)
   - `CIRCLE_APP_ID` (your 36-char app_id)
   - `ARC_RPC_URL` (your $RPC variable value)
   - `JWT_SECRET` (any random 32+ char string)
   - `PUBLIC_BASE_URL` (set to `https://pazzera.com` so CORS works)
4. **Custom domain `api.pazzera.com`**:
   - Railway → Settings → Networking → Custom Domain → add `api.pazzera.com`
   - Railway gives you a CNAME target like `<service>-production.up.railway.app`
   - In Cloudflare DNS for pazzera.com: change the `api` record from A 66.241.125.200 to **CNAME** → that Railway target, with **Proxy ON** (orange cloud)
   - Cloudflare handles SSL automatically (Railway's cert is publicly trusted, so SSL mode can stay on Full Strict)
5. **Update Cloudflare Pages env var**:
   - `PAZZERA_API` = `https://api.pazzera.com`

The VPS nginx setup is no longer needed. We can leave it running or shut it down later.
