-- Push notifications for the installed app: one row per phone that allowed them, and when a ticket was decided.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  notify_tickets BOOLEAN NOT NULL DEFAULT TRUE,
  notify_matches BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

-- When the ticket got its final status (WON / LOST / VOID): the notifier looks only at tickets decided after its last run.
ALTER TABLE bets ADD COLUMN IF NOT EXISTS settled_at BIGINT;

-- Stamped by the database itself whenever a ticket's status changes to a final one, so no settlement code has to know about it.
CREATE OR REPLACE FUNCTION bets_stamp_settled_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('WON', 'LOST', 'VOID') AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.settled_at := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bets_stamp_settled_at ON bets;
CREATE TRIGGER trg_bets_stamp_settled_at
  BEFORE UPDATE OF status ON bets
  FOR EACH ROW EXECUTE FUNCTION bets_stamp_settled_at();
