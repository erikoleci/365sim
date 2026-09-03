# bet365sim

Platformë simulimi bastesh sportive (demo/edukative — **jo për para reale**), me kuota **reale** nga [The Odds API](https://the-odds-api.com), backend Node.js/Express/SQLite, autentikim JWT, dhe panel administrimi.

> ⚠️ Ky projekt është vetëm për qëllime demonstrimi/edukimi. Nuk përpunon pagesa reale dhe s'është menduar për përdorim si bookmaker i licencuar.

## Arkitektura

```
├── App.tsx, components/, index.tsx     # Frontend: React + TypeScript + Vite
├── services/api.ts                     # Klient i vetëm për të gjitha thirrjet /api
├── server/
│   ├── server.js                       # Express app (helmet, cors, rate-limit)
│   ├── db.js                           # PostgreSQL, skema + cache + odds history + live stats
│   ├── oddsUtils.js                    # Mapping kuotash + përkthim shqip (i përbashkët)
│   ├── london365.js                    # Provider LondonPro365: import i plotë + live sync
│   ├── london365Socket.js              # Klient nativ Socket.IO për feed-in live
│   ├── ws.js                           # Njoftimet WebSocket (odds changed, goal)
│   ├── sportmonks.js                   # Burim shtesë për rezultate live
│   └── routes/
│       ├── auth.js                     # regjistrim / login / JWT
│       ├── matches.js                  # lista, refresh/fallback, odds, live details
│       ├── bets.js                     # vendosje basti, verifikim kuotash server-side
│       └── admin.js                    # import/status London365, user-a, settlement
```

## Instalimi

```bash
npm install
cp .env.example .env
```

Plotëso `.env`:

```
PORT=3001
JWT_SECRET=<varg i gjatë e i rastësishëm>
ODDS_API_KEY=<çelësi yt nga the-odds-api.com>
```

## Xhirimi lokal (2 procese)

```bash
npm run server     # backend -> http://localhost:3001
npm run dev         # frontend -> http://localhost:5173 (proxy /api -> backend)
```

Hapi faqen te `http://localhost:5173`.

**Admin i parazgjedhur** (krijohet automatikisht herën e parë që niset serveri):
`username: root` / `password: root` (dhe një user test: `user` / `user`) — **ndërroji menjëherë nga vetë admin panel-i** (Reset Password), këto janë kredenciale të dobëta vetëm për testim lokal.

## Çfarë është reale tani

- ✅ Kuota **reale** nga bookmakers, jo të halucinuara nga AI
- ✅ **Çdo kampionat futbolli** i mbuluar nga The Odds API (marrë dinamikisht, jo hardcoded)
- ✅ **6 tregje** për ndeshje: 1X2, Totali i Golave, BTTS, Shans i Dyfishtë, Barazim=Rimbursim, Hendikep — kuota më e mirë e kombinuar nga të gjithë bookmakers
- ✅ Fjalëkalimet e hash-uara (bcrypt), jo plaintext
- ✅ Bilanci dhe bastet ruhen në PostgreSQL, jo `localStorage`
- ✅ Kuotat riverifikohen në server para se të pranohet basti (mbrojtje kundër kuotave të vjetruara)
- ✅ Settlement i bastesh bazuar në rezultat real (jo simulim AI): automatik për 1X2/Totale/BTTS, override manual për tregje më komplekse
- ✅ JWT + role-based access (admin vs user), rate-limiting kundër brute-force, helmet për HTTP headers

## Provider-i LondonPro365 (`server/london365.js`)

Përveç The Odds API, aplikacioni mund të ushqehet plotësisht nga **LondonPro365** — një burim i të dhënave sportive që ofron çdo sport, kampionat, ndeshje, treg, koeficient, rezultat live dhe përditësime në lojë. Të dhënat konvertohen në formatin kanonik *The Odds API* dhe ruhen në `matches_cache`, kështu që listimi, detaji i ndeshjes, verifikimi i kuotave, historiku i kuotave dhe settlement-i funksionojnë mbi to pa ndryshime.

- **Import në sfond**: çdo 10 minuta (i kufizuar nga `LONDON365_IMPORT_THROTTLE_MS`) tërhiqet i gjithë katalogu — sporte → kampionate → ndeshje → çdo treg/koeficient (modaliteti `--full` përmes endpoint-it `prematchgame`).
- **Live sync (REST)**: çdo 30 sekonda (`LONDON365_LIVE_INTERVAL_MS`) përditësohen rezultatet, minuta dhe lëvizjet e kuotave në lojë — ky mbetet si rrjet mbrojtës kur socket-i bie.
- **Live feed (Socket.IO nativ)**: klienti `server/london365Socket.js` (socket.io-client 2.4) lidhet me `LONDON365_SOCKET` në dhomat `inplay` dhe `prematch-games`, dhe përpunon ngjarjet `new-coefs`, `new-game`, `new-live-game`, `delete-live-game` dhe `delete-live-coef` për përditësime në nën-sekondë. Të gjitha shkruhen në `matches_cache`, `odds_history`, `match_events` dhe `live_statistics`, pastaj shtyhen te klientët me WebSocket (`odds changed`, `goal`). Golat deduplikohen nga ndryshimi i rezultatit të ruajtur, dhe përgjigjet e paplotë të provider-it nuk e mbivendosin kurrë katalogun më të plotë të ruajtur.
- **Mbrojtje nga race conditions**: një write-lock serializon importin në sfond, polling-un live dhe shkrimet nga socket-i që të mos konkurojnë për të njëjtën rresht.
- **Fallback automatik**: kur nuk ka `ODDS_API_KEY`, API-ja e ndeshjeve i shërben ndeshjet e importuara nga LondonPro365.

### Endpoint-e admin (kërkojnë JWT admin)

- `POST /api/admin/london365/import` — nisë një import të menjëhershëm të plotë.
- `GET /api/admin/london365/status` — raportoi ndeshjet e importuara, ndeshjet live, kohën e importit/sinkronizimit të fundit dhe numrin e kampionateve.

### Konfigurimi (`.env`)

```
LONDON365_ENABLED=1              # 0 për ta çaktivizuar krejt
LONDON365_API=https://eccoplay365.com
LONDON365_SPORTS=1               # csv i ID-ve të sporteve (1 = Futboll)
LONDON365_LEAGUES=0              # kufi kampionatesh për sport, 0 = të gjitha
LONDON365_FULL=1                 # 1 = tërhiq çdo treg përmes detail endpoint
LONDON365_LIVE_INTERVAL_MS=30000
LONDON365_IMPORT_THROTTLE_MS=600000
LONDON365_SOCKET=https://ecco.socketi355.com:1440
LONDON365_SOCKET_ENABLED=1       # 0 = vetëm polling REST, pa socket
```

> ⚠️ **Përdorim i autorizuar vetëm.** Ky provider nuk është burim i hapur publik. Përdore vetëm nëse ke autorizim nga mbajtësi i API-së. Respekto kufijtë e normës (thirrjet janë të kufizuara dhe me retry/backoff); mos e ul intervalin e importit pa e matur ndikimin te shërbimi.

### Testet e integrimit

`tests/london365.test.js` mbulon parser-in e kuotave, mapping-un e tregjeve dhe ndihmësit e datës/resolut. `tests/london365-integration.test.js` simulon provider-in me një `matches_cache` në memori dhe verifikon: importin e plotë, sinkronizimin live me deduplikim golash, handler-at Socket.IO (`new-coefs`, `new-live-game`, `delete-live-game`, `delete-live-coef`) dhe mbrojtjen nga payload-et e paplotë. Xhiro me `pnpm run test`.

## Kufizime të njohura (të qëllimshme, jo bug)

- **Double Chance, Draw No Bet, Hendikep**: emërtimet e outcome-ve nga API ndryshojnë sipas bookmaker-it dhe s'janë testuar kundrejt të dhënave reale prodhimi — settlement-i i tyre kërkon konfirmim manual nga admin (`PATCH /api/admin/bet-selections/:id`) në vend që të hamendësohet logjikë e pakonfirmuar.
- Plani falas i The Odds API ka **500 kërkesa/muaj** — backend-i cache-on kampionatet 6 orë dhe kuotat 5 minuta për ta respektuar këtë limit; mos e ul këtë interval pa kontrolluar header-in `x-requests-remaining`.
- S'ka ende endpoint të dedikuar për user-in e zakonshëm të anulojë vetë një kupon (vetëm admin mund ta bëjë këtë tani).

## Build për prodhim

```bash
npm run build      # frontend -> dist/
npm run server      # backend + serve i dist/ (i njëjti proces Express)
```

`server/server.js` tani shërben edhe API-në (`/api/*`) edhe skedarët statikë të `dist/` (me SPA fallback) nga i njëjti proces. Kjo është metoda e rekomanduar për deploy sepse:

- Shmang problemin e URL-së së API-së midis dy domain-eve (frontend-i thërret `/api/...` relativisht — funksionon vetëm nëse janë në të njëjtin origin).
- Shmang konfigurime shtesë CORS.

**Baza e të dhënave është PostgreSQL** (jo më SQLite) — kjo i mbijeton redeploy-eve/restarteve pa nevojë për disk të qëndrueshëm apo volume të hostit. Krijo një bazë falas te [neon.tech](https://neon.tech) ose [supabase.com](https://supabase.com) (të dyja kanë plan falas të përhershëm) dhe kopjo connection string-un si `DATABASE_URL`.

**Platforma të rekomanduara** për vetë serverin (backend+frontend): Railway, Render, Fly.io, ose një VPS.

**Hapat për deploy** (p.sh. Render):
1. Krijo bazën Postgres falas (neon.tech ose supabase.com) dhe merr `DATABASE_URL`-in.
2. Vendos variablat e mjedisit: `DATABASE_URL`, `JWT_SECRET` (gjenero një varg të rastësishëm), `API_FOOTBALL_KEY`.
3. Build command: `npm install && npm run build`
4. Start command: `npm run server` (ose `node server/server.js`)

Skema e tabelave krijohet automatikisht (`initDb()`) herën e parë që niset serveri — s'ka nevojë për migrime manuale.

Alternativë me Docker (ka `Dockerfile` gati në repo):
```bash
docker build -t 365sim .
docker run -p 3001:3001 --env-file .env 365sim
```

Nëse prapë preferohet ndarja frontend/backend (Vercel/Netlify + Railway), duhet së pari të modifikohet `services/api.ts` që të lexojë një bazë URL nga `import.meta.env.VITE_API_TARGET` në vend të path-it relativ `/api`, dhe të kufizohet `cors()` te domain-i specifik i frontend-it.