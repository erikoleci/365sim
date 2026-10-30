-- Automatic live-betting risk level per user (see server/liveRisk.js).
-- NORMAL = no restriction, WATCH = longer delay + lower live stake, RESTRICTED = longest delay + lowest live stake.
ALTER TABLE users ADD COLUMN IF NOT EXISTS live_risk TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE users ADD COLUMN IF NOT EXISTS live_risk_hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS live_risk_checked_at BIGINT;
