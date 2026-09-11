import pool from './db.js';

// Moves `amount` from source's balance to target's balance (or, when
// source is null, credits/debits target directly — used for Owner ->
// Agent / Agent -> User top-ups where the "source" is treated as an
// external mint rather than another tracked wallet, matching how the
// existing /api/admin/users/:id/credit endpoint already works today).
//
// Runs inside its own transaction with row locks (FOR UPDATE) so two
// concurrent transfers touching the same account can never race — same
// pattern already used in bets.js/casino.js for stake deduction.
//
// type: short string like 'OWNER_TO_AGENT' | 'AGENT_TO_USER' | 'AGENT_CREDIT_USER'
// Never throws on the ledger insert itself failing to be silent — a bad
// ledger write should fail the whole transfer (money movement without an
// audit trail is worse than no movement), so this intentionally does NOT
// swallow errors the way logAudit() does.
export async function transferBalance({ actorId, sourceId, targetId, amount, type, reference }) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive finite number');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let sourceBefore = null;
    let sourceAfter = null;

    if (sourceId) {
      const { rows: srcRows } = await client.query(
        'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
        [sourceId]
      );
      if (!srcRows[0]) throw new Error('Source account not found');
      sourceBefore = srcRows[0].balance;
      if (sourceBefore < amount) throw new Error('Insufficient balance');
      sourceAfter = sourceBefore - amount;
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, sourceId]);
    }

    const { rows: tgtRows } = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [targetId]
    );
    if (!tgtRows[0]) throw new Error('Target account not found');
    const targetBefore = tgtRows[0].balance;
    const targetAfter = targetBefore + amount;
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, targetId]);

    await client.query(
      `INSERT INTO transactions
        (actor_id, source_id, target_id, amount, type, reference,
         source_balance_before, source_balance_after,
         target_balance_before, target_balance_after, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [actorId, sourceId || null, targetId, amount, type, reference || null,
       sourceBefore, sourceAfter, targetBefore, targetAfter, Date.now()]
    );

    await client.query('COMMIT');
    return { sourceBefore, sourceAfter, targetBefore, targetAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
