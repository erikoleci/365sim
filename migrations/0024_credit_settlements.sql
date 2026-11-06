-- Credit given to an admin can be a TEST / free credit (no cash kept by the super admin, never counted), and the
-- cash an admin hands back to the super admin is written down as settlements, so "what is still owed" is computed.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS credit_settlements (
  id SERIAL PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  currency TEXT NOT NULL DEFAULT 'ALL',
  amount NUMERIC(14,2) NOT NULL,
  created_at BIGINT NOT NULL,
  actor_id TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_credit_settlements_admin ON credit_settlements (admin_id);
