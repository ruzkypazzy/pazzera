#!/usr/bin/env bash
# Pazzera VPS deploy — installs nginx + certbot + pm2, configures reverse proxy,
# runs backend in production mode, and prepares for HTTPS via Let's Encrypt.
#
# Run on your Contabo VPS as root.
#   chmod +x deploy-vps.sh
#   ./deploy-vps.sh
#
# Assumes /opt/pazzera is the app dir and .env exists in /opt/pazzera/server.

set -euo pipefail

APP_DIR=/opt/pazzera
SERVER_DIR=$APP_DIR/server
WEB_DIR=$APP_DIR/web

echo "=== 1. Pulling latest code ==="
cd "$APP_DIR"
sudo -u root git pull

echo "=== 2. Installing backend deps ==="
cd "$SERVER_DIR"
npm install --omit=dev
npm install --no-save typescript@5.6 tsx@4.19

echo "=== 3. Building backend (TypeScript → JS) ==="
npm run build

echo "=== 4. Installing system packages: nginx, certbot, pm2 ==="
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

# Install pm2 globally
npm install -g pm2

echo "=== 5. Starting backend under pm2 ==="
# Stop existing pm2 process if any
pm2 delete pazzera-api 2>/dev/null || true
pm2 start dist/index.js --name pazzera-api --time
pm2 startup systemd -u root --hp /root
pm2 save

echo "=== 6. Configuring nginx for api.pazzera.com ==="
cat > /etc/nginx/sites-available/pazzera-api <<'NGINX'
upstream pazzera_backend {
    server 127.0.0.1:3001;
    keepalive 64;
}

server {
    listen 80;
    server_name api.pazzera.com;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://pazzera_backend;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout  90s;
        proxy_send_timeout  90s;
        client_max_body_size 16m;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/pazzera-api /etc/nginx/sites-enabled/pazzera-api
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "=== 7. Building frontend ==="
cd "$WEB_DIR"
# Copy prod env (PAZZERA_API stays empty = same-origin /api proxy)
cat > .env <<'ENV'
VITE_PAZZERA_API=
VITE_PAZZERA_APP_ID=
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
ENV

npm install
npm run build

echo "=== 8. Done ==="
echo ""
echo "Backend running under pm2 (port 3001)"
echo "Frontend built to $WEB_DIR/dist"
echo "Nginx is serving api.pazzera.com → backend"
echo ""
echo "Next steps (manual, browser required):"
echo " 1. Add pazzera.com to Cloudflare"
echo "    - dash.cloudflare.com → Add site → pazzera.com"
echo "    - Choose Free plan"
echo "    - Update nameservers at your registrar (Cloudflare registrar auto-applies)"
echo "    - Add DNS A record: api → 185.2.101.34 (your VPS IP)"
echo "    - Add DNS A record: @ → (will point to Cloudflare Pages later)"
echo ""
echo " 2. After DNS propagates (~5 min), get SSL cert:"
echo "    certbot --nginx -d api.pazzera.com"
echo ""
echo " 3. Deploy frontend to Cloudflare Pages:"
echo "    - dash.cloudflare.com → Workers & Pages → Create → Pages → Connect GitHub"
echo "    - Repo: ruzkypazzy/pazzera"
echo "    - Build command: cd web && npm install && npm run build"
echo "    - Output dir: web/dist"
echo "    - Add env vars: PAZZERA_APP_ID=<your circle app id>"
echo ""
echo " 4. After Pages deploys, add custom domain in Pages settings:"
echo "    - Set custom domain: pazzera.com"
echo "    - Cloudflare auto-issues SSL"
echo ""
echo " 5. In Circle dashboard, add pazzera.com to allowed origins for CORS"
echo ""
echo "Check backend health:"
echo "    curl https://api.pazzera.com/health"
echo ""
echo "Check pm2 status:"
echo "    pm2 status"
echo "    pm2 logs pazzera-api"