-- When each leg was accepted (ms). "Next goal / corner / card" markets are settled from the match
-- events logged AFTER this moment, so it has to be stored per leg. Older legs stay NULL (never
-- settled as "next event": they are left for manual review / the overdue refund).
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS placed_at BIGINT;
