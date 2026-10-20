# 365sim në PC-në lokale (me link publik)

Çfarë merr: aplikacioni + baza Postgres punojnë në PC-në tënde; sa herë ndizet PC-ja ngrihet gjithçka vetë dhe
**linku i faqes të vjen si njoftim** (telefon/Telegram). Biletat dhe përdoruesit ruhen në disk dhe mbeten pas fikjes/rindezjes.

## Një herë (rreth 10 minuta)

1. Instalo **Docker Desktop** (docker.com). Te Settings → General aktivizo **"Start Docker Desktop when you sign in"**.
2. Në dosjen e projektit: kopjo `.env.local.example` si `.env.local` dhe plotëso:
   - `POSTGRES_PASSWORD`, `JWT_SECRET` – çfarëdo vargje të gjata të rastësishme
   - `ADMIN_PASSWORD` – fjalëkalimi i ri i adminit (zëvendëson `admin/admin`, që është i hapur për këdo me linkun!)
   - `AGENT_PASSWORD` – fjalëkalimi i ri i `root` (nëse e lë bosh, mbetet `root/root`)
   - Njoftimi: `NTFY_TOPIC` (vendos një emër të gjatë të rastësishëm, instalo aplikacionin **ntfy** në telefon dhe abonohu te ky emër)
     ose `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
3. Nise: `local\start.bat` (Windows) ose `sh local/start.sh` (Linux/Mac).
   Ndërtimi i parë zgjat disa minuta. Pastaj të vjen njoftimi me linkun.

## Përditë

Ndez PC-në → hyr në Windows → Docker niset vetë → pas ~1-2 minutash të vjen linku i ri. Nuk bën asgjë tjetër.
Linku gjendet edhe në skedarin `local-data/CURRENT_LINK.txt`, dhe nga ky PC faqja hapet te http://localhost:3001.

Shënim: linku ndryshon çdo herë që niset tunneli (është adresë e përkohshme `trycloudflare.com`), por të dhënat mbeten.
Për një link që nuk ndryshon kurrë të duhet një domen i yti dhe Cloudflare Tunnel i emëruar (falas).

## Kopje rezervë dhe kalimi i të dhënave të vjetra

- Rezervë: `sh local/backup.sh` (ruan skedar .sql.gz te `local-data/backups`). Bëje herë pas here dhe kopjoje diku jashtë PC-së.
- Të dhënat e hostimit të vjetër (Neon/Render): `sh local/import-from-remote.sh "postgresql://..."` (mbishkruan bazën lokale).

## Kujdes

- **Mos përdor** `docker compose down -v`: fshin volumin me të gjitha biletat. `down` pa `-v`, fikja dhe rindezja janë të sigurta.
- Kur PC-ja është e fikur, faqja nuk hapet. Biletat që janë luajtur mbeten dhe shfaqen kur ndizet përsëri.
- Ndeshjet live dhe shlyerja kërkojnë që PC-ja të jetë ndezur; bileta e një ndeshjeje që mbaron kur PC-ja është e fikur mbyllet kur ndizet ose kthehet automatikisht sipas rregullave ekzistuese.
- Kushdo me linkun e shikon faqen; kyçja kërkon llogari. Mos e shpërndaj linkun publikisht.
