import pool, { getKV, setKV } from './db.js';

const KEY = process.env.ODDSPAPI_KEY || '';
const BASE = 'https://api.oddspapi.io/v4';
const REFRESH_MS = 12 * 60 * 60 * 1000;

const TOURNAMENTS = [
  { id: 17, league: 'soccer_epl' },
  { id: 8, league: 'soccer_spain_la_liga' },
  { id: 23, league: 'soccer_italy_serie_a' },
  { id: 35, league: 'soccer_germany_bundesliga' },
  { id: 34, league: 'soccer_france_ligue_one' },
  { id: 7, league: 'soccer_uefa_champs_league' },
  { id: 679, league: 'soccer_uefa_europa_league' },
  { id: 34480, league: 'soccer_uefa_europa_conference_league' },
  { id: 242, league: 'soccer_usa_mls' },
  { id: 325, league: 'soccer_brazil_campeonato' },
];

const MARKET_MAP = { 101: 'h2h', 105: 'totals' };

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function similar(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export async function refreshOddsPapi() {
  if (!KEY) return;
  const last = await getKV('oddspapi_last', 0);
  if (Date.now() - last < REFRESH_MS) return;
  await setKV('oddspapi_last', Date.now());

  const ids = TOURNAMENTS.map((t) => t.id).join(',');
  let data;
  try {
    const resp = await fetch(`${BASE}/odds-by-tournaments?tournamentIds=${ids}&apiKey=${KEY}`);
    data = await resp.json();
  } catch (err) {
    console.error('[oddspapi] fetch failed:', err.message);
    return;
  }
  if (!Array.isArray(data)) {
    console.error('[oddspapi] unexpected response:', JSON.stringify(data).slice(0, 300));
    return;
  }

  const leagueByTid = Object.fromEntries(TOURNAMENTS.map((t) => [t.id, t.league]));

  for (const fx of data) {
    const league = leagueByTid[fx.tournamentId];
    if (!league || !fx.participant1Name || !fx.participant2Name) continue;

    const { rows: candidates } = await pool.query(
      `SELECT id, home_team, away_team, raw_json FROM matches_cache WHERE league = $1 AND status != 'FINISHED'`,
      [league]
    );

    // Require BOTH home and away to match (not just one side) — avoids
    // false positives like "Real Madrid" vs "Real Sociedad".
    const match = candidates.find(
      (c) => similar(c.home_team, fx.participant1Name) && similar(c.away_team, fx.participant2Name)
    );
    if (!match) continue;

    let parsed;
    try { parsed = JSON.parse(match.raw_json); } catch { continue; }
    parsed.bookmakers = parsed.bookmakers || [];

    for (const [bmName, bm] of Object.entries(fx.bookmakerOdds || {})) {
      const markets = [];
      for (const [mid, mData] of Object.entries(bm.markets || {})) {
        const key = MARKET_MAP[mid];
        if (!key) continue;
        const outcomes = [];
        for (const [oid, oData] of Object.entries(mData.outcomes || {})) {
          const p = oData.players?.['0'];
          if (!p || p.price == null) continue;
          const name = oid === '101' ? 'Home' : oid === '102' ? 'Draw' : oid === '103' ? 'Away' : oid;
          outcomes.push({ name, price: p.price });
        }
        if (outcomes.length) markets.push({ key, outcomes });
      }
      if (markets.length) parsed.bookmakers.push({ title: `oddspapi:${bmName}`, markets });
    }

    await pool.query('UPDATE matches_cache SET raw_json = $1 WHERE id = $2', [JSON.stringify(parsed), match.id]);
  }
}
