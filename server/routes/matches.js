import express from 'express';
import pool from '../db.js';
import { mapEventToMatch } from '../oddsUtils.js';
import { ensureLondon365Import, getLondon365LeagueNames } from '../london365.js';

const router = express.Router();

// --- Fixture de-duplication safety net -------------------------------
// LondonPro365 is the ONLY match source. Every row's id is 'l365-<gameId>',
// which is already unique per fixture, so true duplicates shouldn't occur —
// this stays only as a defensive net (e.g. a fixture briefly reachable
// under two different league classifications during a country/league
// remap) and to keep the richer LIVE/FINISHED status when it does.
function outcomeCount(m) {
  let n = 0;
  for (const mk of m.markets || []) n += (mk.options || []).length;
  return n;
}
function normTeam(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|sc|ac|afc|fk|if|bk|sk|cd|sd|ud|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
function teamSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}
function sameFixture(a, b) {
  const ah = normTeam(a.homeTeam), aa = normTeam(a.awayTeam);
  const bh = normTeam(b.homeTeam), ba = normTeam(b.awayTeam);
  const direct = teamSim(ah, bh) >= 0.75 && teamSim(aa, ba) >= 0.75;
  const swapped = teamSim(ah, ba) >= 0.75 && teamSim(aa, bh) >= 0.75;
  return direct || swapped;
}
const STATUS_RANK = { UPCOMING: 0, LIVE: 1, FINISHED: 2 };
function dedupeMatches(list) {
  const WINDOW_MS = 3 * 60 * 60 * 1000;
  const sorted = [...list].sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime));
  const groups = []; // {rep, candidates, time}
  for (const m of sorted) {
    const t = Date.parse(m.startTime);
    let placed = false;
    if (!Number.isNaN(t)) {
      for (const g of groups) {
        if (Math.abs(t - g.time) > WINDOW_MS) continue;
        if (sameFixture(g.rep, m)) {
          g.candidates.push(m);
          placed = true;
          break;
        }
      }
    }
    if (!placed) groups.push({ rep: m, candidates: [m], time: t });
  }
  return groups.map((g) => {
    let best = g.candidates[0];
    for (const c of g.candidates) {
      const cs = outcomeCount(c);
      const bs = outcomeCount(best);
      if (cs > bs) best = c;
    }
    best = { ...best };
    for (const c of g.candidates) {
      if (c === best || (STATUS_RANK[c.status] || 0) <= (STATUS_RANK[best.status] || 0)) continue;
      best.status = c.status;
      best.isLive = c.isLive;
      best.liveHomeScore = c.liveHomeScore ?? best.liveHomeScore;
      best.liveAwayScore = c.liveAwayScore ?? best.liveAwayScore;
      best.currentMinute = c.currentMinute ?? best.currentMinute;
    }
    return best;
  });
}

// LondonPro365 is the sole match/odds source. Every request kicks a
// throttled background import (ensureLondon365Import no-ops if one already
// ran recently or is in progress — see LONDON365_IMPORT_THROTTLE_MS) and
// then serves whatever's currently cached, so the response is always fast
// regardless of import progress.
router.get('/', async (req, res) => {
  ensureLondon365Import();
  const { rows } = req.query.league
    ? await pool.query('SELECT * FROM matches_cache WHERE league = $1 ORDER BY start_time ASC', [req.query.league])
    : await pool.query("SELECT * FROM matches_cache WHERE id LIKE 'l365-%' ORDER BY start_time ASC");
  console.log(`[matches] GET / -> ${rows.length} cached row(s)${req.query.league ? ` for league=${req.query.league}` : ''}`);
  res.json({ matches: dedupeMatches(rows.map(mapEventToMatch)), leagueNames: getLondon365LeagueNames() });
});

router.get('/:id/odds-history', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at FROM odds_history WHERE match_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ history: rows });
});

// Live stats + match events for the Match Details "Statistika"/"Ngjarjet"
// tabs. Both tables are already populated by the live sync above when the
// source feed provides them (see persistEvent/syncSource) — this just
// exposes what was already being written but never read back.
router.get('/:id/live-detail', async (req, res) => {
  const [{ rows: statsRows }, { rows: eventRows }, { rows: cacheRows }] = await Promise.all([
    pool.query('SELECT * FROM live_statistics WHERE match_id = $1', [req.params.id]),
    pool.query(
      'SELECT minute, type, team, player, detail, created_at FROM match_events WHERE match_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    ),
    pool.query('SELECT live_minute, live_home_score, live_away_score, status FROM matches_cache WHERE id = $1', [req.params.id]),
  ]);
  // The provider's live feed carries the real in-play clock (e.g. "62:14")
  // even when the stats table has no minute yet — expose it so the pitch
  // shows a genuine running minute for LondonPro365 games.
  let statistics = statsRows[0] || null;
  const cache = cacheRows[0];
  if (cache) {
    const m = String(cache.live_minute || '').match(/^(\d+)/);
    if (!statistics) {
      statistics = {
        minute: m ? Number(m[1]) : null,
        home_score: cache.live_home_score,
        away_score: cache.live_away_score,
      };
    } else if (statistics.minute == null && m) {
      statistics = { ...statistics, minute: Number(m[1]) };
    }
  }
  res.json({ statistics, events: eventRows });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: mapEventToMatch(rows[0]) });
});

export default router;
