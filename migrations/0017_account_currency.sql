-- The currency a player account was opened in: 'ALL' (lek only), 'EUR' (euro only) or 'BOTH'.
-- Every account that existed before this column keeps both wallets ('BOTH').
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_currency TEXT NOT NULL DEFAULT 'BOTH';
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT account_currency_values CHECK (account_currency IN ('ALL','EUR','BOTH'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
