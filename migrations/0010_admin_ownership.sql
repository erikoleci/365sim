-- Each admin owns his own agents, and each agent's users: users.admin_id = the owning admin.
-- (Only AGENT and USER rows carry it; ADMIN / SUPER_ADMIN rows leave it NULL.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_admin_id ON users (admin_id);

-- One-time hand-over of everything that exists today: when the database has exactly ONE admin, all
-- existing agents and users (with the users of those agents) become his. With several admins nothing
-- is guessed: the rows stay unowned (only the super admin sees them) until he assigns them.
DO $$
DECLARE only_admin TEXT;
BEGIN
  IF (SELECT COUNT(*) FROM users WHERE role = 'ADMIN') = 1 THEN
    SELECT id INTO only_admin FROM users WHERE role = 'ADMIN';
    UPDATE users SET admin_id = only_admin WHERE role IN ('AGENT', 'USER') AND admin_id IS NULL;
  END IF;
END $$;

-- A user created by an agent belongs to the same admin as the agent, whichever code path inserts him.
CREATE OR REPLACE FUNCTION users_inherit_admin() RETURNS trigger AS $$
BEGIN
  IF NEW.admin_id IS NULL AND NEW.agent_id IS NOT NULL THEN
    SELECT admin_id INTO NEW.admin_id FROM users WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_inherit_admin ON users;
CREATE TRIGGER trg_users_inherit_admin BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_inherit_admin();
