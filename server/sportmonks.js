import pool, { getKV, setKV } from './db.js';
import { settleMatch } from './matchSettlement.js';
import { pushGoal } from './ws.js';

// Sportmonks (sportmonks.com) — supplementary LIVE score source.
// Docs: https://docs.sportmonks.com/v3/football/livescores
// Get a token at https://my.sportmonks.com/ and set SPORTMONKS_KEY.
//
// This only ever UPDATES matches that already exist in matches_cache
// (created by a primary provider like The Odds API / API-Football) — it
// does not create new match rows, since the inplay endpoint has no odds
// and its own fixture IDs don't line up with ours. It matches by team
// name (same fuzzy approach as highlightly.js) and just keeps
// live_home_score/live_away_score/status fresh, same as the other
// live-score supplements in this repo.
//
// Rate limit: per Sportmonks docs, don't poll /inplay faster than ~10s;
// we default to 20s to stay well clear of that, and free-plan responses
// are limited to whichever leagues are on the account anyway.

const KEY = process.env.SPORTMONKS_KEY || '';
const BASE = 'https://api.sportmonks.com/v3/football';
const REFRESH_MS = Number(process.env.SPORTMONKS_REFRESH_MS || 20000);

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function similar(a, b) { a = norm(a); b = norm(b); return a && b && (a === b || a.includes(b) || b.includes(a)); }

export async function refreshSportmonks() {
  if (!KEY) return;
  const last = await getKV('sportmonks_last', 0);
  if (Date.now() - last < REFRESH_MS) return;
  await setKV('sportmonks_last', Date.now());

  const url = `${BASE}/livescores/inplay?api_token=${encodeURIComponent(KEY)}&include=scores;participants;state`;
  let data;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[sportmonks] HTTP ${resp.status} on /livescores/inplay`);
      return;
    }
    data = await resp.json();
  } catch (err) {
    console.error('[sportmonks] network error:', err.message);
    return;
  }

  const fixtures = data?.data;
  if (!Array.isArray(fixtures)) {
    console.error('[sportmonks] unexpected response shape:', JSON.stringify(data).slice(0, 300));
    return;
  }
  if (fixtures.length === 0) return; // nothing currently in-play — normal outside match hours

  const { rows: candidates } = await pool.query(
    `SELECT id, home_team, away_team, live_home_score, live_away_score FROM matches_cache WHERE status != 'FINISHED'`
  );

  for (const fx of fixtures) {
    const home = fx.participants?.find((p) => p.meta?.location === 'home')?.name;
    const away = fx.participants?.find((p) => p.meta?.location === 'away')?.name;
    if (!home || !away) continue;

    const cand = candidates.find((c) => similar(c.home_team, home) && similar(c.away_team, away));
    if (!cand) continue;

    // Sportmonks' `scores` array has one row per participant for the same
    // description, so find both sides explicitly rather than assuming order.
    const homeRow = fx.scores?.find((s) => s.description === 'CURRENT' && s.score?.participant === 'home');
    const awayRow = fx.scores?.find((s) => s.description === 'CURRENT' && s.score?.participant === 'away');
    if (!homeRow || !awayRow) continue;
    const hs = homeRow.score.goals;
    const as = awayRow.score.goals;
    if (hs == null || as == null) continue;

    const shortState = (fx.state?.short_name || fx.state?.state || '').toUpperCase();
    const finished = ['FT', 'AET', 'FT_PEN', 'CANCELLED', 'ABANDONED'].includes(shortState);

    if (finished) {
      if (shortState === 'FT' || shortState === 'AET' || shortState === 'FT_PEN') {
        await settleMatch(cand.id, hs, as);
      }
      continue;
    }

    const scoreChanged = cand.live_home_score !== hs || cand.live_away_score !== as;
    await pool.query(
      `UPDATE matches_cache SET status = 'LIVE', live_home_score = $1, live_away_score = $2 WHERE id = $3 AND status != 'FINISHED'`,
      [hs, as, cand.id]
    );
    if (scoreChanged && (cand.live_home_score != null || cand.live_away_score != null)) {
      pushGoal(cand.id, { homeScore: hs, awayScore: as });
    }
  }
}
