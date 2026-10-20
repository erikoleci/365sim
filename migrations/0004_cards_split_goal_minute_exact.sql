-- Yellow / red card counters kept apart (live_statistics.cards_* stays yellow+red) so
-- yellow-only and red-card markets can be settled.
ALTER TABLE live_statistics ADD COLUMN IF NOT EXISTS yellow_home INTEGER;
ALTER TABLE live_statistics ADD COLUMN IF NOT EXISTS yellow_away INTEGER;
ALTER TABLE live_statistics ADD COLUMN IF NOT EXISTS red_home INTEGER;
ALTER TABLE live_statistics ADD COLUMN IF NOT EXISTS red_away INTEGER;
-- TRUE when a goal event's minute was read from the provider game clock at the moment the
-- score changed (not from a later REST sync, not a goal of a multi-goal gap). Only such
-- goals are trusted for "Minuta e Golit" markets.
ALTER TABLE match_events ADD COLUMN IF NOT EXISTS minute_exact BOOLEAN;
