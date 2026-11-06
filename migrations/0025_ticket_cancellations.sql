-- Every ticket cancelled (refunded and removed) is written down here: who did it, why, and whether the super admin has seen it.
-- An admin MUST give a reason; the super admin gets the unread ones as a notification (red number on the "Anulime" tab).
CREATE TABLE IF NOT EXISTS ticket_cancellations (
  id SERIAL PRIMARY KEY,
  bet_id TEXT NOT NULL,
  ticket_no BIGINT,
  user_id TEXT NOT NULL,
  owner_admin_id TEXT,
  actor_id TEXT NOT NULL,
  actor_username TEXT,
  actor_role TEXT,
  stake NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ALL',
  status_before TEXT,
  decided_legs INTEGER NOT NULL DEFAULT 0,
  balance_change NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason TEXT,
  created_at BIGINT NOT NULL,
  seen_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_ticket_cancellations_created ON ticket_cancellations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_cancellations_unseen ON ticket_cancellations (seen_at) WHERE seen_at IS NULL;
