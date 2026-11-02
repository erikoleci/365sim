-- Final results of settled matches, kept after the match row itself is cleaned out of matches_cache.
-- "To qualify" is decided on the SUM of the two legs of a tie; the first leg is usually a week (or more) older than
-- the second one, and finished matches leave matches_cache after about a week. This small table keeps just the
-- score (regular time), so the second leg can still be settled. Rows are removed after 90 days (cleanupOldData).
CREATE TABLE IF NOT EXISTS match_results (
  match_id TEXT PRIMARY KEY,
  league TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  start_time TEXT,
  result_home INTEGER NOT NULL,
  result_away INTEGER NOT NULL,
  saved_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS match_results_tie_idx ON match_results (league, home_team, away_team);

-- The matches still in the cache that are already finished and settled (the first legs of ties that are still going on).
INSERT INTO match_results (match_id, league, home_team, away_team, start_time, result_home, result_away, saved_at)
SELECT id, league, home_team, away_team, start_time, result_home, result_away, COALESCE(settled_at, fetched_at)
  FROM matches_cache
 WHERE status = 'FINISHED' AND result_home IS NOT NULL AND result_away IS NOT NULL
ON CONFLICT (match_id) DO NOTHING;
