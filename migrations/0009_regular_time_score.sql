-- Score at the end of regular time (90' + stoppage), stored when the match enters extra time.
-- Markets such as the final result, totals and both-teams-to-score are settled on this score:
-- goals in extra time do not count for them.
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS rt_home INTEGER;
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS rt_away INTEGER;
