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
- **Live sync (REST)**: çdo 20 sekonda (`LONDON365_LIVE_INTERVAL_MS`) përditësohen rezultatet, minuta dhe lëvizjet e kuotave në lojë — ky mbetet si rrjet mbrojtës kur socket-i bie.
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
LONDON365_LIVE_INTERVAL_MS=20000
LONDON365_IMPORT_THROTTLE_MS=600000
LONDON365_SOCKET=https://ecco.socketi355.com:1440
LONDON365_SOCKET_ENABLED=1       # 0 = vetëm polling REST, pa socket
```

> ⚠️ **Përdorim i autorizuar vetëm.** Ky provider nuk është burim i hapur publik. Përdore vetëm nëse ke autorizim nga mbajtësi i API-së. Respekto kufijtë e normës (thirrjet janë të kufizuara dhe me retry/backoff); mos e ul intervalin e importit pa e matur ndikimin te shërbimi.

### Testet e integrimit

`tests/london365.test.js` mbulon parser-in e kuotave, mapping-un e tregjeve dhe ndihmësit e datës/resolut. `tests/london365-integration.test.js` simulon provider-in me një `matches_cache` në memori dhe verifikon: importin e plotë, sinkronizimin live me deduplikim golash, handler-at Socket.IO (`new-coefs`, `new-live-game`, `delete-live-game`, `delete-live-coef`) dhe mbrojtjen nga payload-et e paplotë. Xhiro me `pnpm run test`.

## Rruga live dhe shkallëzimi

Të dhënat live vijnë nga dy rrugë që plotësojnë njëra-tjetrën:

| Rruga | Skedari | Çfarë sjell | Kosto |
|---|---|---|---|
| Lista REST (çdo 30 s) | `server/london365.js` (`syncLondon365Live`) | të gjitha ndeshjet: rezultat, minutë, koeficientët 1X2 | **1 kërkesë** për të gjitha ndeshjet |
| Rifreskimi i plotë i tregjeve | `server/london365.js` + `server/liveDetailPlan.js` | të gjitha tregjet e një ndeshjeje | 1 kërkesë për ndeshje, me **buxhet** për cikël |
| Socket-i i detajeve (~1/s) | `server/london365GameDetails.js` | ora, rezultati, kartonat, veprimi në fushë | 1 lidhje për të gjitha ndeshjet |

Si arrin te klienti: `ws.js` grumbullon tikët në një kornizë `LIVE_TICKS` çdo 250 ms (jo një mesazh për ndeshje),
dhe `App.tsx` i zbaton të gjitha me një `setMatches` çdo 250 ms. Orën e ndeshjes e shkruan në DB `clockWrites.js`, në grupe.

Rifreskimi i plotë ka buxhet (`LONDON365_LIVE_DETAIL_BUDGET`): ndeshjet me bast të hapur dhe ato që po i shikon dikush
rifreskohen të parat, pastaj ato që s'janë rifreskuar kurrë, pastaj rrotullim sipas më të vjetrës. Nëse ka më pak ndeshje
se buxheti, rifreskohen të gjitha në çdo cikël.

### Variabla që ndikojnë live-in

| Variabla | Parazgjedhja | Çfarë bën |
|---|---|---|
| `LONDON365_ALL_MATCHES` | çaktivizuar | `1` = importo **çdo** ndeshje (pa filtër shtetesh, ligash, divizioni të dytë) |
| `LONDON365_LIVE_DETAIL_BUDGET` | `120` | sa ndeshje marrin rifreskim të plotë tregjesh në çdo cikël (`0` = të gjitha) |
| `LONDON365_LIVE_CONCURRENCY` / `_MAX` | `6` / `8` | kërkesa paralele te provideri; rritet vetë sipas numrit të ndeshjeve, deri te maksimumi |
| `LONDON365_API_TIMEOUT_MS` | `12000` | koha maksimale e një kërkese te provideri |
| `LIVE_BET_EVENT_LOCK_MS` | `30000` | bastet pezullohen kaq kohë pas golit/kartonit të kuq (`0` = fikur) |
| `LIVE_BET_ODDS_MAX_AGE_MS` | `120000` | bastet refuzohen nëse tregjet jo-1X2 s'janë rifreskuar kaq kohë (`0` = fikur) |
| `UNSETTLED_BET_VOID_AFTER_HOURS` | `4` | leg pa rezultat/rregull rimbursohet kaq orë pas fillimit (`0` = fikur) |
| `PG_POOL_MAX` | `7` | lidhje DB për instancë (2 instanca gjatë deploy duhet të futen nën limitin e pooler-it) |
| `SETTLE_SCORE_WITHOUT_CLOCK_AFTER_MIN` | `0` (off) | një rezultat i ruajtur pa orë ndeshjeje besohet vetëm pas kaq minutash nga fillimi (p.sh. `130`). Pa të, bileta e një ndeshjeje pa orë rri hapur deri te rimbursimi 24h. Shiko `/api/admin/settle-diagnose` para se ta ndezësh |
| `BET_REQUIRE_SETTLEMENT_RULE` | çaktivizuar | `1` = refuzo (dhe shfaq të kyçur) çdo treg pa rregull settlement-i automatik, para ndeshjes dhe gjatë saj. Garanton që asnjë biletë e pranuar nuk mbetet pa mënyrë vendosjeje; shiko `/api/admin/market-coverage` para se ta ndezësh |

### Mjete diagnostikuese për adminin

| Endpoint (admin) | Çfarë jep |
|---|---|
| `GET /api/admin/market-coverage` | çdo treg që ka baste ose është në tabelë: me çfarë rregulli vendoset, a hapet gjatë lojës, dhe sa baste mbeten pa rregull (ato mbyllen me dorë ose me rimbursim pas 24 orësh) |
| `GET /api/admin/feed-keys` | çdo fushë e papërpunuar që ka dërguar provideri (lista REST, detaji live, socket-i) me disa vlera shembull. Hape gjatë ndeshjeve me gola për të parë nëse ka emra golashënuesish, logo skuadrash etj. (`server/feedKeySampler.js`); zhvlerësohet me rinisjen e serverit |
| `GET /api/admin/settle-diagnose?q=Augsburg` | për çdo ndeshje me baste të hapura: statusi, rezultati dhe ora e ruajtur, kur filloi, dhe **arsyeja e saktë pse nuk është shlyer** (sipas të njëjtit rregull që përdor cikli live) |
| `POST /api/admin/bets/settle-stuck` | nis menjëherë sweep-in e biletave të ngecura |

### Kapaciteti (matur, jo premtim)

Matja me DB të simuluar, vetëm për shtresën e socket-it (`applyGameDetails`): rreth 29,000 mesazhe/s me 10,000 ndeshje
njëkohësisht. Serveri real mund të jetë më ngadalë. Kufijtë e vërtetë janë tre: sa ndeshje dhe sa shpejt jep **provideri**,
CPU/memoria e **hostit**, dhe madhësia e listës `/api/matches` (përmban të gjitha tregjet e secilës ndeshje; me mijëra
ndeshje duhet faqosje ose version i lehtë).

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

**Aiven PostgreSQL (SSL).** Aiven e nënshkruan certifikatën e serverit me një CA private të projektit, kështu që një `DATABASE_URL` me `?sslmode=require` jep `SELF_SIGNED_CERT_IN_CHAIN` nëse aplikacioni nuk e njeh atë CA. Zgjidhja është t'i japësh aplikacionit CA-në (lidhja mbetet e verifikuar plotësisht) — **jo** `NODE_TLS_REJECT_UNAUTHORIZED=0`:

1. Te faqja e shërbimit në Aiven shkarko **CA certificate** (`ca.pem`).
2. Vendos NJËRËN nga variablat: `DATABASE_CA_CERT_FILE=<rruga e ca.pem>` ose `DATABASE_CA_CERT=<teksti PEM>` (në një rresht lejohen `\n` të shkruara).
3. Verifiko: `npm run db:check` (bën `SELECT 1`, kontrollon që sesioni është i enkriptuar, ekzekuton `initDb()` dhe migrimet).

Pa CA, lidhja mbetet e enkriptuar por pa verifikim të certifikatës (sjellja e mëparshme), dhe në log del paralajmërimi `[db] The database certificate is not being verified…`. Logjika është te `server/dbConfig.js`.

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
## Team logos

Crests are local files in `public/team-logos/<country>/<club>.webp` plus an `index.json` (normalised team name -> file). `components/TeamLogo.tsx` is the only component that draws a crest; `utils/teamLogos.ts` resolves a team name to a file (exact normalised-name match, aliases, league country as tie-break) and falls back to the provider's crest, then to an initials tile.

- **Add or refresh logos:** `node scripts/build-team-logos.mjs` (clones the two source repos to a temp dir, rasterises every crest to a 72px WebP, rebuilds the index). Add countries in the `COUNTRIES` list at the top of the script.
- **A club shows initials although a logo exists under another spelling:** add one line to `TEAM_ALIASES` in `utils/teamLogos.ts` (`'feed spelling': ['collection key']`; keys are lower-case without FC/AC/... and accents).
- **Sources:** JoseArroyave/football-logos (MIT) and leoratzlaff/football-badges (MIT per package.json). See `public/team-logos/SOURCES.md`. The crests are club trademarks, shown only to identify teams.

## Super admin

`SUPER_ADMIN` is above `ADMIN` (the owner): everything an admin does, plus giving credit to admins
(`POST /api/admin/admins/:id/credit`, ledger type `SUPER_TO_ADMIN`), creating and deleting admin accounts,
and erasing any ticket (`DELETE /api/admin/bets/:id`, `?adjust=0` leaves the balances alone). An admin can
no longer give credit to an admin account, not even his own.

**What a normal admin sees.** Users, agents and credit, the **profit / loss / net** figures with the number of
open, won and lost tickets (`GET /api/admin/dashboard/kpi`), the ticket list and the audit log. Markets, the odds
feed and every settlement tool (market report, pending legs, manual settle, exposure, diagnostics) are the super
admin's: those routes answer a normal admin `403`.

**Credit book (the "Kredia" tab, super admin).** Every credit given to an admin (and every one taken back) is
already a ledger row (`SUPER_TO_ADMIN` / `ADMIN_TO_SUPER`); `GET /api/admin/credit-ledger` turns them into one
book: per admin what was given, taken back, what is left on his balance, what was used, and the cash the super
admin keeps for each credit (`OWNER_CREDIT_FEE_RATE`, default 10%, frozen on the credit in
`transactions.fee_rate` when it is given, so changing the rate later never rewrites the history). Lek and euro are
never added together. The tab also gives credit (lek and/or euro), filters the history by admin and exports it as
CSV. The cash is not reduced when credit is taken back. Credit given outside the app is not in the book.

**Results.** "Rezultate" lists only the main competitions (Champions League, Europa League, World Cup, European
Championship, and the top flight of Italy, Germany, France, Spain, England, Portugal): `utils/majorResults.ts`
and `server/majorResults.js` (keep the two in step). Other finished matches are removed one day after settling
(`RETENTION_MINOR_FINISHED_HOURS`) unless a ticket points at them.

**Speed.** The match list is served from memory (`server/routes/matches.js`): serialized and gzipped once per
refresh, at most 15 s old, kept warm while the app is in use. `GET /api/matches/live` returns only the matches in
play and is what a tab asks for first when it opens or comes back.

**Ticket deletion switch.** `PUT /api/admin/settings/ticket-deletion {allowed:true|false}` (super admin only; the
button is on the Tickets tab) allows or forbids normal admins to delete tickets (`403 TICKET_DELETE_DISABLED`).
Stored in `kv_store` (`ticket_deletion_allowed`), on by default. The super admin can always delete.

No password is stored in the repo. Create the account with either:

- environment on server start (created only when missing): `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD` (min. 6 chars), optional `SUPER_ADMIN_NAME`
- the command line (creates it, or promotes an existing account and sets its password): `npm run super-admin -- <username> <password> [name]`
