-- Which half an event happened in (1 or 2), taken from the match status when it was logged.
-- The minute alone cannot tell: a corner at 45+2 (clock 46:xx, first-half stoppage time) and a
-- second-half event at 46' both carry the label 46-47. NULL = unknown (older rows).
ALTER TABLE match_events ADD COLUMN IF NOT EXISTS half SMALLINT;
