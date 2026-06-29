#!/usr/bin/env bash
# Nightly Postgres backup to /var/backups/pazzera/
# Set up via cron: 0 3 * * * /opt/pazzera/scripts/backup-postgres.sh
set -euo pipefail

BACKUP_DIR="/var/backups/pazzera"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="pazzera_${TIMESTAMP}.sql.gz"
KEEP_DAYS=14

mkdir -p "${BACKUP_DIR}"

docker exec pazzera-postgres pg_dump -U pazzera -d pazzera --no-owner --clean --if-exists \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "[$(date -u +%FT%TZ)] backup ok: ${FILENAME} ($(stat -c%s "${BACKUP_DIR}/${FILENAME}") bytes)"

# Retention
find "${BACKUP_DIR}" -name "pazzera_*.sql.gz" -mtime +${KEEP_DAYS} -delete
echo "[$(date -u +%FT%TZ)] retention applied (${KEEP_DAYS} days)"