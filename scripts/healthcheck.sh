#!/usr/bin/env bash
# Healthcheck — verify web + socket + db are responding.
set -euo pipefail

echo "[$(date -u +%FT%TZ)] healthcheck start"

curl -sf https://pazzera.com/api/health >/dev/null && echo "web ok" || echo "web FAIL"
curl -sf https://pazzera.com/socket.io/?EIO=4\&transport=polling >/dev/null && echo "socket ok" || echo "socket FAIL"
docker exec pazzera-postgres pg_isready -U pazzera >/dev/null && echo "db ok" || echo "db FAIL"
docker exec pazzera-redis redis-cli ping >/dev/null && echo "redis ok" || echo "redis FAIL"