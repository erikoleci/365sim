import pool from './db.js';

// Records an admin action for the audit trail. Never throws — a logging
// failure should never block the actual admin action from completing.
export async function logAudit(actor, action, target, details) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_username, action, target, details, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [actor.id, actor.username, action, target || null, details ? JSON.stringify(details) : null, Date.now()]
    );
  } catch (err) {
    console.error('[audit] Failed to write audit log entry:', err.message);
  }
}
