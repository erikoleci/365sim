-- casino_rounds already exists (the table-game rounds). The slots add the wallet currency and the number of free
-- spins a round triggered; existing rows were all played in lek, which is what the defaults say.
ALTER TABLE casino_rounds ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE casino_rounds ADD COLUMN IF NOT EXISTS free_spins INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS casino_rounds_game_idx ON casino_rounds (game, created_at DESC);
