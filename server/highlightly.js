import pool, { getKV, setKV } from './db.js';
import { settleMatch } from './matchSettlement.js';

const KEY = process.env.HIGHLIGHTLY_KEY || '';
const REFRESH_MS = 15 * 60 * 1000; // 100 req/day budget -> every 15 min fits (96/day)

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function similar(a, b) { a = norm(a); b = norm(b); return a && b && (a === b || a.includes(b) || b.includes(a)); }

export async function refreshHighlightly() {
  if (!KEY) return;
  const last = await getKV('hl_last', 0);
  if (Date.now() - last < REFRESH_MS) return;
  await setKV('hl_last', Date.now());

  const today = new Date().toISOString().slice(0, 10);
  let data;
  try {
    const resp = await fetch(`https://soccer.highlightly.net/football/matches?date=${today}`, {
      headers: { 'x-rapidapi-key': KEY },
    });
    data = await resp.json();
  } catch (err) {
    console.error('[highlightly] fetch failed:', err.message);
    return;
  }
  const matches = data?.data;
  if (!Array.isArray(matches)) {
    console.error('[highlightly] unexpected response:', JSON.stringify(data).slice(0, 300));
    return;
  }

  const { rows: candidates } = await pool.query(
    `SELECT id, home_team, away_team FROM matches_cache WHERE status != 'FINISHED'`
  );

  for (const m of matches) {
    const home = m.homeTeam?.name || m.home_team;
    const away = m.awayTeam?.name || m.away_team;
    if (!home || !away) continue;
    const cand = candidates.find((c) => similar(c.home_team, home) && similar(c.away_team, away));
    if (!cand) continue;

    const homeScore = m.homeScore ?? m.home_score ?? m.state?.score?.current?.home;
    const awayScore = m.awayScore ?? m.away_score ?? m.state?.score?.current?.away;
    const status = (m.status || m.state?.description || '').toLowerCase();

    if (homeScore == null || awayScore == null) continue;

    if (status.includes('finished') || status === 'ft') {
      await settleMatch(cand.id, homeScore, awayScore);
    } else {
      await pool.query(
        `UPDATE matches_cache SET status = 'LIVE', live_home_score = $1, live_away_score = $2 WHERE id = $3 AND status != 'FINISHED'`,
        [homeScore, awayScore, cand.id]
      );
    }
  }
}
