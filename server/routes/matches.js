import express from 'express';
import pool, { getKV, setKV } from '../db.js';
import { mapEventToMatch, diffOddsChanges } from '../oddsUtils.js';
import { pushOddsChanged, pushGoal, pushMatchStarted, pushLiveEvent } from '../ws.js';
import { settleMatch } from '../matchSettlement.js';
import { isConfigured as sourceConfigured, configurationStatus, fetchLeagues, fetchMatches, fetchMatchOdds, fetchLive } from '../authorizedFeed.js';

const router = express.Router();
const SOURCE_REFRESH_MS = Number(process.env.SOURCE_REFRESH_MS || 30000);
const LIVE_REFRESH_MS = Number(process.env.SOURCE_LIVE_REFRESH_MS || 3000);
let lastSourceSync = 0;
let syncPromise = null;

async function persistEvent(event, { preserveFinished = true } = {}) {
  const now = Date.now();
  const { rows: oldRows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [event.id]);
  const old = oldRows[0];
  if (old?.raw_json) {
    const changes = diffOddsChanges(event.id, JSON.parse(old.raw_json), event);
    if (changes.length) {
      for (const c of changes) {
        await pool.query(
          `INSERT INTO odds_history (match_id, market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at)
           VALUES ($1,$2,$3,$4,$5,'SYSTEM','source_refresh',$6)`,
          [c.matchId, c.marketId, c.selectionId, c.oldOdds, c.newOdds, now]
        );
      }
      pushOddsChanged(event.id, { changes });
    }
  }

  const status = event.completed ? 'FINISHED' : (event.status === 'LIVE' ? 'LIVE' : 'UPCOMING');
  const liveHome = event.live_home_score ?? null;
  const liveAway = event.live_away_score ?? null;
  const liveMinute = event.live_minute ?? null;
  await pool.query(
    `INSERT INTO matches_cache
      (id, league, home_team, away_team, start_time, status, raw_json, fetched_at, live_home_score, live_away_score, live_minute, source, country)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       league=excluded.league,
       home_team=excluded.home_team,
       away_team=excluded.away_team,
       start_time=excluded.start_time,
       status=CASE WHEN $14 AND matches_cache.status='FINISHED' THEN matches_cache.status ELSE excluded.status END,
       raw_json=excluded.raw_json,
       fetched_at=excluded.fetched_at,
       live_home_score=COALESCE(excluded.live_home_score,matches_cache.live_home_score),
       live_away_score=COALESCE(excluded.live_away_score,matches_cache.live_away_score),
       live_minute=COALESCE(excluded.live_minute,matches_cache.live_minute),
       source=excluded.source,
       country=excluded.country`,
    [event.id, event.league, event.home_team, event.away_team, event.commence_time, status, JSON.stringify(event), now,
      liveHome, liveAway, liveMinute, event.source || 'authorized-feed', event.country || null, preserveFinished]
  );

  if (old && old.status !== 'LIVE' && status === 'LIVE') pushMatchStarted(event.id);
  if (old && liveHome != null && liveAway != null && (liveHome !== old.live_home_score || liveAway !== old.live_away_score)) {
    const scoringTeam = liveHome > (old.live_home_score ?? 0) ? event.home_team : event.away_team;
    await pool.query(
      `INSERT INTO match_events (match_id, minute, type, team, detail, created_at)
       VALUES ($1,$2,'GOAL',$3,'score_update',$4)`,
      [event.id, Number.parseInt(String(liveMinute || ''), 10) || null, scoringTeam, now]
    );
    pushGoal(event.id, { homeScore: liveHome, awayScore: liveAway, scoringTeam, minute: liveMinute });
  }

  if (event.completed && liveHome != null && liveAway != null && old?.status !== 'FINISHED') {
    await settleMatch(event.id, Number(liveHome), Number(liveAway));
  }
}

async function syncSource() {
  if (!sourceConfigured()) return { configured: false, synced: false };
  const now = Date.now();
  const { rows: liveRows } = await pool.query(`SELECT 1 FROM matches_cache WHERE status='LIVE' LIMIT 1`);
  const refreshInterval = liveRows.length ? LIVE_REFRESH_MS : SOURCE_REFRESH_MS;
  if (now - lastSourceSync < refreshInterval) return { configured: true, synced: false };
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    lastSourceSync = now;
    const baseMatches = await fetchMatches();
    for (const base of baseMatches) {
      let event = base;
      try {
        const odds = await fetchMatchOdds(base.id);
        if (odds) event = odds;
      } catch (err) {
        console.warn(`[source] odds unavailable for ${base.id}: ${err.message}`);
      }
      await persistEvent(event);
    }

    const { rows: active } = await pool.query(
      `SELECT id FROM matches_cache WHERE status IN ('UPCOMING','LIVE') ORDER BY start_time ASC LIMIT 1000`
    );
    for (const row of active) {
      try {
        const live = await fetchLive(row.id);
        if (!live) continue;
        const { rows: currentRows } = await pool.query('SELECT * FROM matches_cache WHERE id=$1', [row.id]);
        const current = currentRows[0];
        const home = Number.isFinite(live.homeScore) ? live.homeScore : current.live_home_score;
        const away = Number.isFinite(live.awayScore) ? live.awayScore : current.live_away_score;
        const raw = current.raw_json ? JSON.parse(current.raw_json) : {};
        raw._sourceMeta = { ...(raw._sourceMeta || {}), liveMinute: live.minute };
        await pool.query(
          `UPDATE matches_cache SET status=$1, live_home_score=$2, live_away_score=$3, live_minute=$4, raw_json=$5, fetched_at=$6 WHERE id=$7`,
          [live.completed ? 'FINISHED' : 'LIVE', home ?? null, away ?? null, live.minute ?? null, JSON.stringify(raw), Date.now(), row.id]
        );
        if (live.statistics) {
          const s = live.statistics;
          await pool.query(
            `INSERT INTO live_statistics (match_id, minute, home_score, away_score, possession_home, possession_away, shots_home, shots_away, shots_on_target_home, shots_on_target_away, corners_home, corners_away, cards_home, cards_away, xg_home, xg_away, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (match_id) DO UPDATE SET minute=excluded.minute, home_score=excluded.home_score, away_score=excluded.away_score,
             possession_home=excluded.possession_home, possession_away=excluded.possession_away, shots_home=excluded.shots_home, shots_away=excluded.shots_away,
             shots_on_target_home=excluded.shots_on_target_home, shots_on_target_away=excluded.shots_on_target_away, corners_home=excluded.corners_home,
             corners_away=excluded.corners_away, cards_home=excluded.cards_home, cards_away=excluded.cards_away, xg_home=excluded.xg_home, xg_away=excluded.xg_away, updated_at=excluded.updated_at`,
            [row.id, live.minute ?? null, home ?? 0, away ?? 0, s.possession_home ?? null, s.possession_away ?? null, s.shots_home ?? null, s.shots_away ?? null,
              s.shots_on_target_home ?? null, s.shots_on_target_away ?? null, s.corners_home ?? null, s.corners_away ?? null, s.cards_home ?? null, s.cards_away ?? null,
              s.xg_home ?? null, s.xg_away ?? null, Date.now()]
          );
        }
        if (live.events?.length) {
          for (const e of live.events) {
            const type = String(e.type || 'EVENT').toUpperCase();
            const detail = JSON.stringify(e);
            const { rowCount } = await pool.query(
              `INSERT INTO match_events (match_id, minute, type, team, player, detail, created_at)
               SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS
               (SELECT 1 FROM match_events WHERE match_id=$1 AND type=$3 AND minute IS NOT DISTINCT FROM $2 AND detail=$6)`,
              [row.id, Number.parseInt(String(e.minute ?? ''), 10) || null, type, e.team ?? null, e.player ?? null, detail, Date.now()]
            );
            if (rowCount) pushLiveEvent(row.id, { event: e });
          }
        }
        if (live.completed && home != null && away != null) await settleMatch(row.id, Number(home), Number(away));
      } catch (err) {
        console.warn(`[source] live update failed for ${row.id}: ${err.message}`);
      }
    }
    return { configured: true, synced: true, count: baseMatches.length };
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}


export function startSourceScheduler() {
  if (!sourceConfigured()) return;
  const tick = async () => {
    try { await syncSource(); } catch (err) { console.error('[source] background sync failed:', err.message); }
  };
  tick();
  setInterval(tick, Math.max(1000, Number(process.env.SOURCE_SCHEDULER_MS || 5000))).unref?.();
}

router.get('/source-status', (req, res) => res.json(configurationStatus()));

router.get('/leagues', async (req, res) => {
  if (sourceConfigured()) {
    try { return res.json({ leagues: await fetchLeagues() }); }
    catch (err) { return res.status(502).json({ error: 'Could not load leagues from authorized source', detail: err.message }); }
  }
  res.json({ leagues: [] });
});

router.get('/', async (req, res) => {
  if (sourceConfigured()) {
    try { await syncSource(); }
    catch (err) { console.error('[source] sync failed:', err.message); }
    const params = [];
    let query = 'SELECT * FROM matches_cache';
    if (req.query.league) { query += ' WHERE league = $1'; params.push(req.query.league); }
    query += ' ORDER BY start_time ASC';
    const { rows } = await pool.query(query, params);
    return res.json({ matches: rows.map(mapEventToMatch), source: 'authorized-feed' });
  }
  const { rows } = await pool.query('SELECT * FROM matches_cache ORDER BY start_time ASC');
  res.json({ matches: rows.map(mapEventToMatch), source: 'unconfigured' });
});

router.get('/:id/odds-history', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT market_id, selection_id, old_odds, new_odds, changed_by, reason, created_at FROM odds_history WHERE match_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ history: rows });
});

router.get('/:id', async (req, res) => {
  if (sourceConfigured()) {
    try { await syncSource(); } catch (err) { console.warn('[source] match sync:', err.message); }
  }
  const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: mapEventToMatch(rows[0]) });
});

export default router;
