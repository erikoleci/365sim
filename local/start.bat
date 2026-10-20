@echo off
docker compose --env-file .env.local -f docker-compose.local.yml up -d --build
echo Linku do te vije si njoftim; gjendet edhe te local-data\CURRENT_LINK.txt
pause
