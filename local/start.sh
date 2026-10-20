#!/bin/sh
docker compose --env-file .env.local -f docker-compose.local.yml up -d --build && cat local-data/CURRENT_LINK.txt 2>/dev/null
