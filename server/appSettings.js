import pool from './db.js';

// Small switches the super admin controls, kept in kv_store (key / value text).

const TICKET_DELETION_KEY = 'ticket_deletion_allowed';

// Are normal admins allowed to delete tickets? Default: yes (the behaviour before the switch existed).
// Any read problem also answers "yes" so an unreadable setting never locks the admins out by accident.
export async function getTicketDeletionAllowed() {
  try {
    const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [TICKET_DELETION_KEY]);
    return !rows[0] || rows[0].value !== 'false';
  } catch {
    return true;
  }
}

export async function setTicketDeletionAllowed(allowed) {
  await pool.query(
    'INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [TICKET_DELETION_KEY, allowed ? 'true' : 'false']
  );
  return Boolean(allowed);
}
