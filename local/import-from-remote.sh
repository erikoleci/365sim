#!/bin/sh
# Kalon të dhënat e hostimit të vjetër (Neon/Render/...) në bazën lokale. Përdorim:
#   sh local/import-from-remote.sh "postgresql://user:pass@host/db?sslmode=require"
# Ekzekutoje PAS nisjes së parë (db duhet të punojë). Mbishkruan përmbajtjen lokale.
set -e
[ -n "$1" ] || { echo "jep URL-në e bazës së vjetër"; exit 1; }
C="docker compose --env-file .env.local -f docker-compose.local.yml"
$C stop app tunnel notifier secure >/dev/null 2>&1 || true
$C exec -T db psql -U sim365 -d postgres -c "DROP DATABASE IF EXISTS sim365 WITH (FORCE)" -c "CREATE DATABASE sim365 OWNER sim365"
docker run --rm postgres:16-alpine pg_dump --no-owner --no-privileges "$1" | $C exec -T db psql -U sim365 -d sim365 -v ON_ERROR_STOP=1
$C up -d
echo "U kalua. Linku i ri vjen në njoftim."
