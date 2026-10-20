-- Corner / card counters at the half-time whistle, so first-half and second-half
-- corner and card markets can be settled (second half = final counter - half-time counter).
-- Filled once per match by server/halfTime.js (first write wins).
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS ht_corners_home INTEGER;
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS ht_corners_away INTEGER;
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS ht_cards_home INTEGER;
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS ht_cards_away INTEGER;
