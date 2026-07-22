import pool, { getKV, setKV } from './db.js';

const KEY = process.env.BSD_KEY || '';
const REFRESH_MS = 6 * 60 * 60 * 1000;

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function similar(a, b) { a = norm(a); b = norm(b); return a && b && (a === b || a.includes(b) || b.includes(a)); }

export async function refreshBsd() {
  if (!KEY) return;
  const last = await getKV('bsd_last', 0);
  if (Date.now() - last < REFRESH_MS) return;
  await setKV('bsd_last', Date.now());

  let data;
  try {
    const resp = await fetch('https://sports.bzzoiro.com/api/events/', {
      headers: { Authorization: `Token ${KEY}` },
    });
    data = await resp.json();
  } catch (err) {
    console.error('[bsd] fetch failed:', err.message);
    return;
  }
  const events = data?.results;
  if (!Array.isArray(events)) {
    console.error('[bsd] unexpected response:', JSON.stringify(data).slice(0, 300));
    return;
  }

  const { rows: candidates } = await pool.query(
    `SELECT id, home_team, away_team, raw_json FROM matches_cache WHERE status != 'FINISHED'`
  );

  for (const ev of events) {
    if (ev.odds_home == null || ev.odds_draw == null || ev.odds_away == null) continue;
    const match = candidates.find(
      (c) => similar(c.home_team, ev.home_team) && similar(c.away_team, ev.away_team)
    );
    if (!match) continue;

    let parsed;
    try { parsed = JSON.parse(match.raw_json); } catch { continue; }
    parsed.bookmakers = parsed.bookmakers || [];
    parsed.bookmakers.push({
      title: 'bsd',
      markets: [{ key: 'h2h', outcomes: [
        { name: ev.home_team, price: ev.odds_home },
        { name: 'Draw', price: ev.odds_draw },
        { name: ev.away_team, price: ev.odds_away },
      ] }],
    });
    await pool.query('UPDATE matches_cache SET raw_json = $1 WHERE id = $2', [JSON.stringify(parsed), match.id]);
  }
}
