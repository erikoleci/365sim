-- A ticket is "live" when any of its selections was placed on a match that was already running.
-- Needed for the agent commission: live tickets earn the lower rate, whatever their number of results.
ALTER TABLE bets ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE;
