import pool, { getKV, setKV } from './db.js';

const KEY = process.env.ODDSAPIIO_KEY || '';
const BASE = 'https://api.odds-api.io/v3';
const REFRESH_MS = 60 * 60 * 1000; // 100 req/hour budget -> 1x/hour is very safe

// Best-guess league slugs (not verified against a live /v3/leagues call —
// check Render logs for '[oddsapiio] no events for slug' to correct any that miss).
const LEAGUES = [
  { slug: 'england-premier-league', league: 'soccer_epl' },
  { slug: 'spain-laliga', league: 'soccer_spain_la_liga' },
  { slug: 'italy-serie-a', league: 'soccer_italy_serie_a' },
  { slug: 'germany-bundesliga', league: 'soccer_germany_bundesliga' },
  { slug: 'france-ligue-1', league: 'soccer_france_ligue_one' },
  { slug: 'usa-mls', league: 'soccer_usa_mls' },
];

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function similar(a, b) { a = norm(a); b = norm(b); return a && b && (a === b || a.includes(b) || b.includes(a)); }

export async function refreshOddsApiIo() {
  if (!KEY) return;
  const last = await getKV('oaio_last', 0);
  if (Date.now() - last < REFRESH_MS) return;
  await setKV('oaio_last', Date.now());

  for (const { slug, league } of LEAGUES) {
    let events;
    try {
      const resp = await fetch(`${BASE}/events?apiKey=${KEY}&sport=football&league=${slug}&status=pending&bookmaker=Bet365`);
      events = await resp.json();
    } catch (err) {
      console.error(`[oddsapiio] fetch failed for ${slug}:`, err.message);
      continue;
    }
    if (!Array.isArray(events)) {
      console.error(`[oddsapiio] no events for slug '${slug}':`, JSON.stringify(events).slice(0, 200));
      continue;
    }

    const { rows: candidates } = await pool.query(
      `SELECT id, home_team, away_team, raw_json FROM matches_cache WHERE league = $1 AND status != 'FINISHED'`,
      [league]
    );

    for (const ev of events) {
      const home = ev.homeTeam || ev.home_team || ev.participants?.[0]?.name;
      const away = ev.awayTeam || ev.away_team || ev.participants?.[1]?.name;
      if (!home || !away) continue;
      const match = candidates.find((c) => similar(c.home_team, home) && similar(c.away_team, away));
      if (!match) continue;

      let odds;
      try {
        const oResp = await fetch(`${BASE}/odds?apiKey=${KEY}&eventId=${ev.id || ev.eventId}&bookmaker=Bet365`);
        odds = await oResp.json();
      } catch { continue; }
      const markets = [];
      const h2h = odds?.markets?.h2h || odds?.h2h;
      if (h2h) {
        markets.push({ key: 'h2h', outcomes: [
          { name: home, price: h2h.home ?? h2h.homeOdds },
          { name: 'Draw', price: h2h.draw ?? h2h.drawOdds },
          { name: away, price: h2h.away ?? h2h.awayOdds },
        ].filter((o) => o.price != null) });
      }
      if (!markets.length) continue;

      let parsed;
      try { parsed = JSON.parse(match.raw_json); } catch { continue; }
      parsed.bookmakers = parsed.bookmakers || [];
      parsed.bookmakers.push({ title: 'odds-api.io:Bet365', markets });
      await pool.query('UPDATE matches_cache SET raw_json = $1 WHERE id = $2', [JSON.stringify(parsed), match.id]);
    }
  }
}
