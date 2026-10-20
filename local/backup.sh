#!/bin/sh
# Kopje rezervë e bazës: ./local-data/backups/sim365-YYYYMMDD-HHMM.sql.gz
set -e
mkdir -p local-data/backups
f="local-data/backups/sim365-$(date +%Y%m%d-%H%M).sql.gz"
docker compose --env-file .env.local -f docker-compose.local.yml exec -T db pg_dump -U sim365 sim365 | gzip > "$f"
echo "U ruajt $f"
