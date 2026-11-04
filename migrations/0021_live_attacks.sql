-- Attacks and dangerous attacks per team (provider counters H3/A3 and H4/A4), shown as rings on the live stats tab.
ALTER TABLE live_statistics ADD COLUMN IF NOT EXISTS attacks_home INTEGER;
ALTER TABLE live_statistics ADD COLUMN IF NOT EXISTS attacks_away INTEGER;
ALTER TABLE live_statistics ADD COLUMN IF NOT EXISTS dangerous_attacks_home INTEGER;
ALTER TABLE live_statistics ADD COLUMN IF NOT EXISTS dangerous_attacks_away INTEGER;
