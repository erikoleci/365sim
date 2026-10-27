-- When the half-time whistle was first seen (epoch ms), stored with the half-time score.
-- Lets the events list tell first-half stoppage time (45+2') from the second half: an
-- event written before this moment belongs to the first half whatever its minute says.
ALTER TABLE matches_cache ADD COLUMN IF NOT EXISTS ht_at BIGINT;
