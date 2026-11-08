#!/bin/sh
# Deploy i plotë nga Termius:  sh local/deploy.sh          (pa verifikim)
#                              sh local/deploy.sh verify   (pret 90 s dhe printon kontrollin e lidhjeve të ndeshjeve)
# Pas çdo ndërtimi pastron cache-in e Docker (mban 5 GB): pa këtë, çdo deploy shton ~1 GB dhe disku mbushet.
set -e
cd "$(dirname "$0")/.."
COMPOSE="docker compose --env-file .env.local -f docker-compose.local.yml"

echo "== kopje rezervë e databazës (para çdo ndryshimi)"
sh local/backup.sh
ls -t local-data/backups/*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f --   # mban 7 më të fundit
echo "   rikthimi, nëse duhet:  gunzip -c local-data/backups/<skedari>.sql.gz | $COMPOSE exec -T db psql -U sim365 sim365"

echo "== git pull"
PREV=$(git rev-parse --short HEAD)
git pull
echo "   versioni i mëparshëm: $PREV  (kthimi mbrapsht: git checkout $PREV && sh local/deploy.sh)"

echo "== ndërtim + rindezje e aplikacionit (ndërpritet 1-2 minuta)"
$COMPOSE up -d --build app

echo "== pastrim i cache-it të ndërtimit dhe imazheve të vjetra"
docker builder prune -f --keep-storage 5GB >/dev/null || true
docker image prune -f >/dev/null || true

if [ "$1" = "verify" ]; then
  echo "== pres 90 s që aplikacioni të ngrihet"
  sleep 90
  $COMPOSE exec -T app npm run verify:links
  $COMPOSE exec -T app node -e "fetch('http://localhost:3001/api/health').then(r=>r.json()).then(j=>console.log('health:',JSON.stringify(j)))"
fi

echo "== disku:"
df -h / | tail -1
echo "== CPU/memoria:"
docker stats --no-stream
