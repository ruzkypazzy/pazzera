# Deployment runbook

> Phase 10 production deployment of Pazzera. Steps are written so a
> single user can execute them **one command at a time**, reading the
> description, expected output, and what to do next, before pasting
> the next command.
>
> Audience: a server admin with Terminal access (Termius / ssh).
> Stack: Contabo VPS · Ubuntu 24.04 · Docker + Compose · nginx +
> Let's Encrypt · Cloudflare DNS + R2.

## 0. Prerequisites

| Resource | Where to get it |
|---|---|
| Contabo VPS | https://contabo.com — VPS 8 GB recommended |
| Domain | Cloudflare Registrar (e.g. `pazzera.com`) |
| Circle API key | https://console.circle.com — Programmable Wallets |
| Arc Testnet RPC | https://docs.arc.network (free public RPC) |
| Resend API key | https://resend.com (free tier works) |
| Cloudflare R2 | https://cloudflare.com — bucket + access keys |

## 1. SSH into the VPS

```
ssh <user>@<vps-ip>
```

**Expected:** bash prompt (e.g. `root@vps-xxx:~#`).

## 2. Update + install base packages

```
sudo apt-get update && sudo apt-get install -y ca-certificates curl git ufw nginx certbot python3-certbot-nginx
```

**Expected:** apt finishes, "0 newly installed" if cached; otherwise
~20 new packages.

## 3. Install Docker Engine + Compose

```
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exec sudo -u $USER bash -l
docker --version
docker compose version
```

**Expected:**
- `Docker version 24.x`
- `Docker Compose version v2.x.x`

## 4. Open ports 80 / 443 / 22 (skip 3000/3001 — behind nginx)

```
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

**Expected:** "Firewall is active and enabled on system startup".

## 5. Clone the repo at the release tag you want

```
sudo mkdir -p /opt/pazzera && sudo chown $USER /opt/pazzera
git clone https://github.com/ruzkypazzy/pazzera.git /opt/pazzera
cd /opt/pazzera
```

**Expected:** `Cloning into '/opt/pazzera'... Resolving deltas: 100% ...`

## 6. Write the production `.env`

```
cp .env.example .env
nano .env           # or: vim .env
```

Required keys (the server will refuse to boot otherwise):

```
NODE_ENV=production
APP_BASE_URL=https://pazzera.com
ALLOWED_ORIGINS=https://pazzera.com,https://www.pazzera.com,https://api.pazzera.com
DATABASE_URL=postgresql://pazzera:<pgpass>@db:5432/pazzera
REDIS_URL=redis://redis:6379
COOKIE_SECRET=<64-hex>
CSRF_SECRET=<64-hex>
WALLET_MASTER_KEY=<64-hex>
SESSION_COOKIE_NAME=pazzera_sess
RESEND_API_KEY=<your-key>
RESEND_FROM_EMAIL=Pazzera <noreply@pazzera.com>
ARC_RPC_URL=<your-arc-rpc>
USDC_CONTRACT_ADDRESS=0x3600000000000000000000000000000000000000
GATEWAY_WALLET_ADDRESS=0x0077777d7EBA4688BDeF3E311b846F25870A19B9
CIRCLE_API_KEY=<your-circle-key>
CIRCLE_GATEWAY_FACILITATOR_URL=https://gateway-api-testnet.circle.com
CIRCLE_WEBHOOK_SECRET=<your-webhook-secret>
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_BUCKET=pazzera-prod
R2_ACCESS_KEY_ID=<r2-key>
R2_SECRET_ACCESS_KEY=<r2-secret>
R2_PUBLIC_BASE_URL=https://media.pazzera.com
ADMIN_EMAILS=founder@pazzera.com
```

Generate secrets:
```
openssl rand -hex 32    # 64-hex chars (for COOKIE_SECRET, CSRF_SECRET, WALLET_MASTER_KEY)
```

**Expected:** env file contains ~50 lines; no leftover `localhost` URLs.

## 7. Bring up Postgres + Redis

```
docker compose up -d db redis
docker compose ps
```

**Expected:** both containers `running` (or `Up (healthy)` for the
db).

## 8. Push the database schema

```
docker compose run --rm web pnpm --filter @pazzera/db db:push
```

**Expected:** `🚀 Your database is now in sync with your Prisma schema.`

## 9. Build the web monolith image

```
docker compose build web
```

**Expected:** `DONE` after several minutes. The image is tagged
`pazzera-web:latest`.

## 10. Start all services

```
docker compose up -d web realtime workers
docker compose ps
```

**Expected:**
```
NAME           STATUS              PORTS
pazzera-db     Up (healthy)        5432/tcp
pazzera-redis  Up (healthy)        6379/tcp
pazzera-web    Up                  0.0.0.0:3000->3000/tcp
pazzera-rt     Up                  0.0.0.0:3001->3001/tcp
pazzera-work   Up
```

## 11. Smoke test

```
curl http://localhost:3000/ready
```

**Expected:** `{"ok":true,"checks":{"http":"ok","db":"ok"}, ...}`

## 12. Point DNS

In Cloudflare:
- `A pazzera.com` → `<VPS-IP>` (Proxied, Full SSL)
- `A api.pazzera.com` → `<VPS-IP>` (Proxied, Full SSL)
- `CNAME media.pazzera.com` → `<bucket>.r2.cloudflarestorage.com` (Proxied)

## 13. Configure nginx

```
sudo nano /etc/nginx/sites-available/pazzera.com
```

(Use the template in `docs/nginx-pazzera.com.conf`.)

```
sudo ln -s /etc/nginx/sites-available/pazzera.com /etc/nginx/sites-enabled/pazzera.com
sudo nginx -t
```

**Expected:** `nginx: configuration file /etc/nginx/nginx.conf test is successful`

## 14. TLS via Let's Encrypt

```
sudo certbot --nginx -d pazzera.com -d www.pazzera.com -d api.pazzera.com
```

**Expected:** "Congratulations! You have successfully enabled HTTPS."

## 15. Reload + re-test

```
sudo systemctl reload nginx
curl https://pazzera.com/ready
curl https://api.pazzera.com/ready
```

**Expected:** both return JSON `{"ok":true,...}`.

## 16. Bootstrap an admin

In your browser:
1. Visit `https://pazzera.com/sign-up` and create an account.
2. Run from the VPS to promote them to admin:
```
docker compose exec db psql -U pazzera pazzera \
  -c "UPDATE \"User\" SET role='admin' WHERE email='founder@pazzera.com'"
```
3. Restart workers:
```
docker compose restart workers
```
4. Visit `https://pazzera.com/admin` — you should see the system
intelligence view.

## 17. Monitor

Logs:
```
docker compose logs -f web
docker compose logs -f realtime
docker compose logs -f workers
```

Disk usage:
```
docker system df
```

DB size:
```
docker compose exec db psql -U pazzera pazzera -c \
  "SELECT pg_size_pretty(sum(pg_database_size(oid))) FROM pg_database;"
```

## 18. Backups

Cron (run once on the VPS):
```
sudo tee /etc/cron.daily/pazzera-pg-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y%m%d)
docker compose -f /opt/pazzera/docker-compose.yml exec -T db \
  pg_dump -U pazzera -d pazzera -Fc > /var/backups/pazzera-${STAMP}.dump
aws s3 cp /var/backups/pazzera-${STAMP}.dump \
  s3://<private-bucket>/pg-backups/ \
  --endpoint-url https://<accountid>.r2.cloudflarestorage.com \
  || true
find /var/backups -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/pazzera-pg-backup
```

## 19. Update procedure

```
cd /opt/pazzera
git pull
docker compose build web
docker compose up -d web realtime workers
docker compose logs --tail=200 web
```

Watch for restart loops; if a migration is required:
```
docker compose run --rm web pnpm --filter @pazzera/db db:migrate:dev
```

## 20. Roll back

```
git log --oneline -20     # find the previous SHA
git checkout <prev-sha>
docker compose build web
docker compose up -d web realtime workers
```

DB roll-back requires the prior `.dump` in `/var/backups/`.

## SLOs (initial targets)

| SLO | Target |
|---|---|
| `/ready` p95 latency | < 200 ms |
| Realtime tick round-trip | < 150 ms p95 |
| `payment_due → payment_settled` | < 10 s p95 |
| Background queue depth | < 1k messages |
| Indexer lag | < 30 blocks |

Anything outside SLO: page on-call, check `/api/admin/payments-health`
and `/api/admin/streaming-health`.
