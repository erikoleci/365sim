# 365sim

Platformë simulimi bastesh sportive (demo/edukative — jo për para reale).

## Data source

Projekti përdor një adapter të përgjithshëm për **burim sportiv të autorizuar**. Ai nuk anashkalon CAPTCHA, autentikim, rate limits, WAF, robots ose kontrolle të tjera aksesi.

Konfiguro feed-in e autorizuar në `.env`:

```env
SOURCE_BASE_URL=
SOURCE_LEAGUES_URL=
SOURCE_MATCHES_URL=
SOURCE_MATCH_ODDS_URL_TEMPLATE=
SOURCE_MATCH_LIVE_URL_TEMPLATE=
SOURCE_AUTH_TOKEN=
```

`SOURCE_MATCH_ODDS_URL_TEMPLATE` dhe `SOURCE_MATCH_LIVE_URL_TEMPLATE` mund të përmbajnë `{id}`.

Adapteri pranon si evente të normalizuara ashtu edhe payload-in flat me fusha si `market_id`, `market`, `market_option`, `odd`, `game_date`, `league_name`, `country_name`.

## Çfarë ruhet

- të gjitha marketet/options që feed-i i autorizuar dërgon
- historiku i ndryshimeve të odds
- statusi UPCOMING/LIVE/FINISHED
- live score + minutë
- live events/statistika kur feed-i i ofron
- auto-settlement kur feed-i deklaron ndeshjen të përfunduar dhe jep rezultatin

## Run

```bash
npm install
npm run server
npm run dev
```

## Tests

```bash
npm test
npm run build
```
