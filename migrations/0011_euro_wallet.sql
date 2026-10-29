-- Second wallet: every account (user, agent, admin, super admin) has a lek balance (users.balance)
-- AND a euro balance (users.balance_eur). A ticket is placed in one of the two currencies and is
-- staked, refunded and paid out in that same currency (bets.currency: 'ALL' = lek, 'EUR' = euro).
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_eur NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'ALL';
