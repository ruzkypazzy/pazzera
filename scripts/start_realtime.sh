#!/bin/bash
# PM2-managed standalone Socket.IO server (Pazzera realtime / x402).
# Runs alongside pazzera-worker so the realtime stream + payment_due
# events can fire. Listens on SOCKET_PORT (default 3001).
set -a
source /opt/pazzera/.env
export DATABASE_URL="postgresql://pazzera:2872c0bb54cec02a6827de9bee8d813b590cfed9e6b2dee4@127.0.0.1:5432/pazzera?schema=public"
export REDIS_URL="redis://127.0.0.1:6379/0"
export SOCKET_PORT="${SOCKET_PORT:-3001}"
export PAZZERA_LOCAL_STORAGE_ROOT="/opt/pazzera/.local-storage"
set +a
cd /opt/pazzera
exec pnpm --filter @pazzera/realtime exec tsx src/standalone.ts
