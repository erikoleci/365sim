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
export const CURRENCIES = ['ALL', 'EUR'];
export const walletColumn = (currency) => (currency === 'EUR' ? 'balance_eur' : 'balance');
export const normalizeCurrency = (c) => (c === 'EUR' ? 'EUR' : 'ALL');

// Reads the two amounts of a credit/debit request: `amount` = lek, `amountEur` = euro (either or both).
// Returns [{ currency, amount }] for every non-zero part, or null when the body is invalid
// (nothing to move, not a finite number, or a negative amount when `signed` is false).
export function amountParts(body, { signed = false } = {}) {
  const { amount, amountEur } = body || {};
  const parts = [];
  for (const [currency, v] of [['ALL', amount], ['EUR', amountEur]]) {
    if (v === undefined || v === null || v === 0) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || (!signed && v < 0)) return null;
    parts.push({ currency, amount: v });
  }
  return parts.length ? parts : null;
}

// Several transfers (lek and/or euro) in ONE transaction: either all of them happen or none.
// Returns { ALL: result|undefined, EUR: result|undefined }.
export async function transferBalances(base, parts) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = {};
    for (const part of parts) {
      out[part.currency] = await transferOnClient(client, { ...base, amount: part.amount, currency: part.currency });
    }
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function transferBalance(args) {
  const out = await transferBalances(args, [{ currency: normalizeCurrency(args.currency), amount: args.amount }]);
  return out[normalizeCurrency(args.currency)];
}

async function transferOnClient(client, { actorId, sourceId, targetId, amount, type, reference, currency, feeRate }) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive finite number');
  }
  const col = walletColumn(currency);
  const cur = normalizeCurrency(currency);
  const round = (n) => Math.round(n * 100) / 100;
  const createdAt = Date.now();

  let sourceBefore = null;
  let sourceAfter = null;

  if (sourceId) {
    const { rows: srcRows } = await client.query(`SELECT ${col} FROM users WHERE id = $1 FOR UPDATE`, [sourceId]);
    if (!srcRows[0]) throw new Error('Source account not found');
    sourceBefore = Number(srcRows[0][col]);
    if (sourceBefore < amount) throw new Error('Insufficient balance');
    sourceAfter = round(sourceBefore - amount);
    await client.query(`UPDATE users SET ${col} = ${col} - $1 WHERE id = $2`, [amount, sourceId]);
  }

  const { rows: tgtRows } = await client.query(`SELECT ${col} FROM users WHERE id = $1 FOR UPDATE`, [targetId]);
  if (!tgtRows[0]) throw new Error('Target account not found');
  const targetBefore = Number(tgtRows[0][col]);
  const targetAfter = round(targetBefore + amount);
  await client.query(`UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`, [amount, targetId]);

  await client.query(
    `INSERT INTO transactions
      (actor_id, source_id, target_id, amount, type, reference,
       source_balance_before, source_balance_after,
       target_balance_before, target_balance_after, created_at, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [actorId, sourceId || null, targetId, amount, type, reference || null,
     sourceBefore, sourceAfter, targetBefore, targetAfter, createdAt, cur]
  );

  // Credit given to an admin: freeze the cash rate on that very row (the target row is locked, so it is the newest one).
  if (typeof feeRate === 'number' && Number.isFinite(feeRate)) {
    await client.query(
      `UPDATE transactions SET fee_rate = $1
        WHERE id = (SELECT id FROM transactions WHERE target_id = $2 AND type = $3 AND created_at = $4 ORDER BY id DESC LIMIT 1)`,
      [feeRate, targetId, type, createdAt]
    );
  }

  return { sourceBefore, sourceAfter, targetBefore, targetAfter };
}

// Fresh { balance (lek), balanceEur } of one account, for the responses of credit/debit routes.
export async function readWallet(id) {
  const { rows } = await pool.query('SELECT balance, balance_eur FROM users WHERE id = $1', [id]);
  return rows[0] ? { balance: rows[0].balance, balanceEur: rows[0].balance_eur } : { balance: 0, balanceEur: 0 };
}
