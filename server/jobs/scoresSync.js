// server/jobs/scoresSync.js
//
// Background job: periodically pulls live/finished scores from the active
// odds provider and auto-settles matches. This used to be tangled inside
// routes/matches.js (settlement logic triggered by a GET request is an
// anti-pattern — user traffic should never be what decides whether bets
// get settled). Now it is provider-agnostic and runs on an interval,
// independent of whether anyone is browsing the site.

import pool from '../db.js';
import { settleMatch } from '../matchSettlement.js';
import { getActiveProvider } from '../providers/registry.js';

const SCORES_POLL_MS = 2 * 60 * 1000; // check every 2 minutes

export function startScoresSyncJob() {
  setInterval(async () => {
    try {
      const provider = getActiveProvider();
      const { rows: liveOrUpcoming } = await pool.query(
        `SELECT id, league FROM matches_cache WHERE status IN ('UPCOMING','LIVE')`
      );
      const leagues = [...new Set(liveOrUpcoming.map((r) => r.league))];
      for (const league of leagues) {
        const matches = await provider.listMatches({ league });
        for (const m of matches) {
          if (m.status === 'FINISHED' && m.liveScore) {
            await settleMatch(m.id, m.liveScore.home, m.liveScore.away);
          }
        }
      }
    } catch (err) {
      console.error('[scoresSyncJob] failed:', err.message);
    }
  }, SCORES_POLL_MS);
  console.log(`[scoresSyncJob] started, polling every ${SCORES_POLL_MS / 1000}s`);
}
