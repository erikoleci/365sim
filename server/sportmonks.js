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
      `UPDATE matches_cache SET status = 'LIVE', live_home_score = $1, live_away_score = $2, sportmonks_fixture_id = $3 WHERE id = $4 AND status != 'FINISHED'`,
      [hs, as, fx.id, cand.id]
    );
    if (scoreChanged && (cand.live_home_score != null || cand.live_away_score != null)) {
      pushGoal(cand.id, { homeScore: hs, awayScore: as });
    }

    // Enrich with full stats/events — a second call per live match, so it's
    // kept separate from the lightweight inplay poll above (which covers
    // score/status for every live match cheaply). Failures here never
    // affect score tracking; they just mean Statistika/Ngjarjet stay empty
    // for that match this cycle.
    try {
      await syncFixtureDetail(cand.id, fx.id);
    } catch (err) {
      console.error(`[sportmonks] fixture detail sync failed for ${cand.id}:`, err.message);
    }
  }
}

// Statistic type IDs, per https://docs.sportmonks.com/v3/definitions/types/statistics
const STAT_TYPE = { POSSESSION: 45, SHOTS_TOTAL: 42, SHOTS_ON_TARGET: 86, CORNERS: 34, YELLOWCARDS: 84 };
// Event type IDs, per Sportmonks' event-type filter examples (14/19/20/21).
const EVENT_TYPE = { GOAL: 14, SUBSTITUTION: 18, YELLOWCARD: 19, REDCARD: 20, YELLOWRED: 21 };
const EVENT_LABEL = {
  [EVENT_TYPE.GOAL]: 'GOAL',
  [EVENT_TYPE.SUBSTITUTION]: 'SUBSTITUTION',
  [EVENT_TYPE.YELLOWCARD]: 'YELLOW_CARD',
  [EVENT_TYPE.REDCARD]: 'RED_CARD',
  [EVENT_TYPE.YELLOWRED]: 'SECOND_YELLOW',
};

async function fetchFixtureDetail(fixtureId) {
  const url = `${BASE}/fixtures/${fixtureId}?api_token=${encodeURIComponent(KEY)}&include=statistics.type;events;participants`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on /fixtures/${fixtureId}`);
  const json = await resp.json();
  return json?.data;
}

// Pulls the full fixture (statistics + events) for one live match and fills
// in live_statistics/match_events — both tables already existed and are
// already read by GET /matches/:id/live-detail, but until now nothing
// populated the possession/shots/corners/cards fields or non-goal events.
async function syncFixtureDetail(matchId, fixtureId) {
  const fixture = await fetchFixtureDetail(fixtureId);
  if (!fixture) return;

  const home = fixture.participants?.find((p) => p.meta?.location === 'home');
  const away = fixture.participants?.find((p) => p.meta?.location === 'away');

  const statValue = (typeId, location) => {
    const row = fixture.statistics?.find((s) => s.type_id === typeId && s.location === location);
    return row?.data?.value ?? null;
  };

  const now = Date.now();
  await pool.query(
    `INSERT INTO live_statistics
       (match_id, minute, possession_home, possession_away, shots_home, shots_away,
        shots_on_target_home, shots_on_target_away, corners_home, corners_away,
        cards_home, cards_away, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (match_id) DO UPDATE SET
       minute = excluded.minute,
       possession_home = excluded.possession_home, possession_away = excluded.possession_away,
       shots_home = excluded.shots_home, shots_away = excluded.shots_away,
       shots_on_target_home = excluded.shots_on_target_home, shots_on_target_away = excluded.shots_on_target_away,
       corners_home = excluded.corners_home, corners_away = excluded.corners_away,
       cards_home = excluded.cards_home, cards_away = excluded.cards_away,
       updated_at = excluded.updated_at`,
    [
      matchId, fixture.periods?.find((p) => p.has_timer)?.minutes ?? null,
      statValue(STAT_TYPE.POSSESSION, 'home'), statValue(STAT_TYPE.POSSESSION, 'away'),
      statValue(STAT_TYPE.SHOTS_TOTAL, 'home'), statValue(STAT_TYPE.SHOTS_TOTAL, 'away'),
      statValue(STAT_TYPE.SHOTS_ON_TARGET, 'home'), statValue(STAT_TYPE.SHOTS_ON_TARGET, 'away'),
      statValue(STAT_TYPE.CORNERS, 'home'), statValue(STAT_TYPE.CORNERS, 'away'),
      statValue(STAT_TYPE.YELLOWCARDS, 'home'), statValue(STAT_TYPE.YELLOWCARDS, 'away'),
      now,
    ]
  );

  // Events: only insert ones we haven't stored yet (dedupe by minute+type+
  // player, since Sportmonks events have no stable id we already track).
  const nonGoalEvents = (fixture.events || []).filter((e) => e.type_id !== EVENT_TYPE.GOAL && EVENT_LABEL[e.type_id]);
  if (nonGoalEvents.length === 0) return;

  const { rows: existing } = await pool.query(
    `SELECT minute, type, player FROM match_events WHERE match_id = $1`,
    [matchId]
  );
  const seen = new Set(existing.map((e) => `${e.minute}|${e.type}|${e.player}`));

  for (const ev of nonGoalEvents) {
    const type = EVENT_LABEL[ev.type_id];
    const player = ev.player_name || null;
    const key = `${ev.minute}|${type}|${player}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const team = ev.participant_id === home?.id ? home?.name : ev.participant_id === away?.id ? away?.name : null;
    await pool.query(
      `INSERT INTO match_events (match_id, minute, type, team, player, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [matchId, ev.minute ?? null, type, team, player, ev.result || null, now]
    );
  }
}
