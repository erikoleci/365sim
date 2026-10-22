-- Red cards at the half-time whistle, so "sending off in the first half" markets can be settled.
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS ht_red_home INTEGER;
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS ht_red_away INTEGER;
