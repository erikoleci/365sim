-- Support: a player writes a problem (optionally tagging one of his tickets), his admin and the super admin read and answer.
-- The player never sees who answered (messages from staff are just "Support"); sender_id is kept only for the audit trail.
CREATE TABLE IF NOT EXISTS support_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  bet_id TEXT,
  ticket_no BIGINT,
  match_label TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at BIGINT NOT NULL,
  last_message_at BIGINT NOT NULL,
  last_from TEXT NOT NULL DEFAULT 'USER',
  user_seen_at BIGINT NOT NULL DEFAULT 0,
  staff_seen_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  from_role TEXT NOT NULL,            -- 'USER' | 'STAFF'
  sender_id TEXT,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages (thread_id, id);
