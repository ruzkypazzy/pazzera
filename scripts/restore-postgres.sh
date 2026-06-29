#!/usr/bin/env bash
# Restore from a backup file. Usage:
#   ./restore-postgres.sh /var/backups/pazzera/pazzera_20260628_030000.sql.gz
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <backup-file.sql.gz>"
  exit 1
fi

FILE="$1"
if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE"
  exit 1
fi

echo "Restoring $FILE into pazzera DB..."
gunzip -c "$FILE" | docker exec -i pazzera-postgres psql -U pazzera -d pazzera
echo "Restore complete."