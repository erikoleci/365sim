# bet365sim

Platformë simulimi bastesh sportive (demo/edukative — **jo për para reale**), me kuota **reale** nga [The Odds API](https://the-odds-api.com), backend Node.js/Express/SQLite, autentikim JWT, dhe panel administrimi.

> ⚠️ Ky projekt është vetëm për qëllime demonstrimi/edukimi. Nuk përpunon pagesa reale dhe s'është menduar për përdorim si bookmaker i licencuar.

## Arkitektura

```
├── App.tsx, components/, index.tsx     # Frontend: React + TypeScript + Vite
├── services/api.ts                     # Klient i vetëm për të gjitha thirrjet /api
├── server/
│   ├── server.js                       # Express app (helmet, cors, rate-limit)
│   ├── db.js                           # SQLite (better-sqlite3), skema + seed admin
│   ├── oddsUtils.js                    # Mapping kuotash + përkthim shqip (i përbashkët)
│   └── routes/
│       ├── auth.js                     # regjistrim / login / JWT
│       ├── matches.js                  # kuota reale nga The Odds API, cache, çdo kampionat
│       ├── bets.js                     # vendosje basti, verifikim kuotash server-side
│       └── admin.js                    # user-a, settlement, kupona
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
`username: admin` / `password: admin123` — **ndërroje menjëherë nga vetë admin panel-i** (Reset Password).

## Çfarë është reale tani

- ✅ Kuota **reale** nga bookmakers, jo të halucinuara nga AI
- ✅ **Çdo kampionat futbolli** i mbuluar nga The Odds API (marrë dinamikisht, jo hardcoded)
- ✅ **6 tregje** për ndeshje: 1X2, Totali i Golave, BTTS, Shans i Dyfishtë, Barazim=Rimbursim, Hendikep — kuota më e mirë e kombinuar nga të gjithë bookmakers
- ✅ Fjalëkalimet e hash-uara (bcrypt), jo plaintext
- ✅ Bilanci dhe bastet ruhen në SQLite, jo `localStorage`
- ✅ Kuotat riverifikohen në server para se të pranohet basti (mbrojtje kundër kuotave të vjetruara)
- ✅ Settlement i bastesh bazuar në rezultat real (jo simulim AI): automatik për 1X2/Totale/BTTS, override manual për tregje më komplekse
- ✅ JWT + role-based access (admin vs user), rate-limiting kundër brute-force, helmet për HTTP headers

## Kufizime të njohura (të qëllimshme, jo bug)

- **Double Chance, Draw No Bet, Hendikep**: emërtimet e outcome-ve nga API ndryshojnë sipas bookmaker-it dhe s'janë testuar kundrejt të dhënave reale prodhimi — settlement-i i tyre kërkon konfirmim manual nga admin (`PATCH /api/admin/bet-selections/:id`) në vend që të hamendësohet logjikë e pakonfirmuar.
- Plani falas i The Odds API ka **500 kërkesa/muaj** — backend-i cache-on kampionatet 6 orë dhe kuotat 5 minuta për ta respektuar këtë limit; mos e ul këtë interval pa kontrolluar header-in `x-requests-remaining`.
- S'ka ende endpoint të dedikuar për user-in e zakonshëm të anulojë vetë një kupon (vetëm admin mund ta bëjë këtë tani).

## Build për prodhim

```bash
npm run build      # frontend -> dist/
npm run server      # backend, i pandryshuar (Express, jo Vite)
```

Për deploy, backend-i (`server/`) duhet të xhirojë si proces Node.js i vazhdueshëm (jo si funksion serverless pa gjendje, sepse SQLite është skedar lokal) — p.sh. Railway, Render, Fly.io, ose një VPS. Frontend-i (`dist/`) mund të shkojë në Vercel/Netlify me `VITE_API_TARGET` të vendosur te URL-ja e backend-it.
