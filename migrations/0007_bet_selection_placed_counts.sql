-- Counters of the leg's own kind (goals / corners / cards per side) at the moment the ticket was
-- accepted: {"home": n, "away": n}. "Next goal / corner / card" is then decided from the events
-- logged after the bet and checked against (counter now - counter at the bet), so a gap earlier in
-- the match (server started late, a missed corner) no longer blocks settlement.
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS placed_counts JSONB;
