-- State of the match at the moment a leg was booked: clock minute, score and the model's fair probability/edge.
-- Shown on the ticket ("booked at 46' with 0-2") and used to audit live tickets afterwards.
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS placed_state JSONB;
