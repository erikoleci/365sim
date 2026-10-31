-- The cash the super admin keeps for a credit given to an admin (a rate, e.g. 0.1000 = 10%) is frozen on the
-- credit itself when it is given, so changing OWNER_CREDIT_FEE_RATE later never rewrites the history.
-- NULL on every other transaction and on credits made before this column existed (those use the current rate).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_rate NUMERIC(5,4);
