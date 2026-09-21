// Safe user deletion shared by the admin and agent routes.
//
// Before: both routes ran a bare `DELETE FROM users`. users(id) is referenced
// by bets, casino_rounds, favorites, transactions (actor/source/target) and
// users.agent_id, so any user with history made Postgres raise a foreign-key
// violation, which the catch-all error handler turned into an opaque
// "503 Service temporarily unavailable" -- with no hint that the real reason
// was "this user has history".
//
// Money history is never deleted here (bets, ledger, casino rounds must not
// silently vanish). A user with any of it is REFUSED with a clear 409 and the
// caller is pointed at "deactivate" instead. Per-user convenience data
// (favorites) has no value without the user and is removed with it.
import pool from './db.js';

export async function getUserDeleteBlockers(userId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM bets WHERE user_id = $1)::int AS bets,
       (SELECT COUNT(*) FROM casino_rounds WHERE user_id = $1)::int AS casino_rounds,
       (SELECT COUNT(*) FROM transactions WHERE actor_id = $1 OR source_id = $1 OR target_id = $1)::int AS transactions,
       (SELECT COUNT(*) FROM users WHERE agent_id = $1)::int AS sub_users`,
    [userId]
  );
  const c = rows[0] || {};
  const blockers = [];
  if (c.bets) blockers.push({ key: 'bets', count: c.bets, label: c.bets + ' kupona' });
  if (c.transactions) blockers.push({ key: 'transactions', count: c.transactions, label: c.transactions + ' transaksione (kredite/debite)' });
  if (c.casino_rounds) blockers.push({ key: 'casino_rounds', count: c.casino_rounds, label: c.casino_rounds + ' raunde kazinoje' });
  if (c.sub_users) blockers.push({ key: 'sub_users', count: c.sub_users, label: c.sub_users + ' usera nen kete llogari' });
  return blockers;
}

export function deleteBlockedMessage(blockers) {
  return 'Ky user ka histori (' + blockers.map((b) => b.label).join(', ') + ') dhe nuk mund te fshihet, qe te mos humbasin te dhenat financiare. Caktivizoje ne vend te kesaj.';
}

// -> { ok: true } | { ok: false, blockers }
export async function deleteUserIfUnused(userId) {
  const blockers = await getUserDeleteBlockers(userId);
  if (blockers.length) return { ok: false, blockers };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM favorites WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

// Admin-only "delete everything" path: unlike deleteUserIfUnused above, this
// never refuses on history -- it wipes the user's bets, transactions, casino
// rounds and favorites, and recurses into any sub-users it agents for
// (an AGENT with USERs under it), deleting the whole branch. This
// permanently destroys financial history, which is why it's gated to ADMIN
// callers only (enforced in the route) and requires the caller to have
// explicitly asked for a force delete, not the default action.
export async function forceDeleteUser(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await forceDeleteUserTx(client, userId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

async function forceDeleteUserTx(client, userId) {
  // Recurse into sub-users first (e.g. an AGENT's USERs) so the whole branch
  // is gone before we touch this row.
  const { rows: subUsers } = await client.query('SELECT id FROM users WHERE agent_id = $1', [userId]);
  for (const sub of subUsers) {
    await forceDeleteUserTx(client, sub.id);
  }

  const { rows: betRows } = await client.query('SELECT id FROM bets WHERE user_id = $1', [userId]);
  for (const bet of betRows) {
    await client.query('DELETE FROM bet_selections WHERE bet_id = $1', [bet.id]);
  }
  await client.query('DELETE FROM bets WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM casino_rounds WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM favorites WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM transactions WHERE actor_id = $1 OR source_id = $1 OR target_id = $1', [userId]);
  await client.query('DELETE FROM users WHERE id = $1', [userId]);
}
