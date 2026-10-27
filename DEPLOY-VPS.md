# 365sim në VPS (Hostinger KVM 1, Frankfurt)

Gjithçka (faqja, serveri, databaza, HTTPS, kopje ditore) punon me një komandë me Docker Compose.

## 1. Në Hostinger (gjatë porosisë)
- Vendndodhja: **Germany - Frankfurt**.
- Sistemi: **Ubuntu 24.04** (ose shablloni "Ubuntu with Docker", nëse del).
- Domeni falas i vitit të parë: zgjidhe, p.sh. `sim365.shembull.com`.
- Kopja ditore e Hostinger ($3/muaj) nuk është e detyrueshme: ky setup bën vetë kopje ditore (shih më poshtë).

## 2. Domeni → serveri
Te DNS i domenit shto një **A record**: `sim` (ose `@`) → IP e VPS-së (e sheh te paneli i Hostinger).
Prit disa minuta derisa të bëhet aktiv.

## 3. Instalo Docker (vetëm nëse shablloni nuk e ka)
```
ssh root@IP_E_SERVERIT
curl -fsSL https://get.docker.com | sh
```

## 4. Merr projektin dhe plotëso fjalëkalimet
```
git clone https://github.com/erikoleci/365sim /opt/365sim
cd /opt/365sim
cp .env.prod.example .env.prod
nano .env.prod      # DOMAIN, POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PASSWORD, AGENT_PASSWORD
```
Fjalëkalime të gjata të rastësishme: `openssl rand -hex 24`.

## 5. Nise
```
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```
Ndërtimi i parë zgjat disa minuta. Pastaj hap `https://DOMENI_YT`. Certifikata HTTPS merret vetë.
Të gjitha shërbimet kanë `restart: unless-stopped`: ngrihen vetë pas rindezjes së serverit.

## 6. Mbrojtje e serverit (bëje një herë)
```
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```
Portet e databazës dhe të aplikacionit nuk janë të hapura jashtë: vetëm Caddy (80/443).

## Ligat që shfaqen
Si parazgjedhje `docker-compose.prod.yml` importon **të gjitha vendet dhe ligat** (`LONDON365_ONLY_COUNTRIES=*`, `LONDON365_MAJOR_ONLY=0`).
Pas nisjes, ligat shfaqen gradualisht gjatë disa minutave (importi i parë është i ngadalshëm). Nëse do vetëm ligat kryesore,
shto te `.env.prod`: `LONDON365_ONLY_COUNTRIES=England,France,Spain,Italy,Germany` dhe `LONDON365_MAJOR_ONLY=1`.

## Përditësimi i kodit
```
cd /opt/365sim && git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

## Kopjet rezervë
- Çdo ditë ruhet `./backups/sim365-YYYYMMDD-HHMM.sql.gz` (14 ditët e fundit).
- **Kopjoji edhe jashtë serverit** (nëse serveri humbet, humbasin edhe kopjet), p.sh. nga kompjuteri yt:
  `scp -r root@IP:/opt/365sim/backups .`
- Rikthim: `gunzip -c backups/SKEDARI.sql.gz | docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U sim365 sim365`
- Të dhënat nga hostimi i vjetër (Neon/Render): shih `local/import-from-remote.sh`.

## Kujdes
- **Mos përdor** `docker compose down -v`: fshin volumin me përdoruesit dhe biletat. `down` pa `-v` është i sigurt.
- Mos e ngarko `.env.prod` në GitHub (është në `.gitignore`).
- Kontrollo përdorimin e RAM-it për disa ditë (`docker stats`, `free -h`). Nëse kalon rregullisht 3 GB, kalo në KVM 2 nga paneli.
