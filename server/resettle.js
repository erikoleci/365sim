import { ticketOutcome } from './ticketOutcome.js';

// Re-decides a ticket by hand AFTER it was already closed (e.g. a leg the 4-hour rule refunded, which the
// super admin now knows lost), and moves the player's balance by exactly the difference between what the
// ticket had already paid and what it is now worth. Runs inside the caller's transaction.
//
//   paid before:  WON -> potential_return | VOID -> stake | LOST / PENDING -> 0
//   worth now:    WON -> payout           | VOID -> stake | LOST -> 0
//   balance change = worth now - paid before   (a refunded ticket turned LOST takes the stake back)
//
// legOutcomes: [{ id, outcome }]  (outcome WON | LOST | VOID | HALF_WON | HALF_LOST); legs not listed keep
// their status. The result must be a decided ticket (nothing left PENDING). A balance that would go
// negative refuses the whole change. dryRun only reads: it returns what would happen.

const OUTCOMES = new Set(['WON', 'LOST', 'VOID', 'HALF_WON', 'HALF_LOST']);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

export class ResettleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const paidBefore = (bet) => (bet.status === 'WON' ? round2(bet.potential_return) : bet.status === 'VOID' ? round2(bet.stake) : 0);

export function worthNow(stake, legs) {
  const outcome = ticketOutcome(stake, legs);
  if (outcome.status === 'PENDING') return null;
  if (outcome.status === 'LOST') return { status: 'LOST', payout: 0, totalOdds: legs.reduce((a, l) => a * Number(l.odds), 1) };
  if (outcome.status === 'VOID') return { status: 'VOID', payout: round2(stake), totalOdds: 1 };
  const allOdds = legs.reduce((a, l) => a * Number(l.odds), 1);
  return {
    status: 'WON',
    payout: outcome.payout != null ? round2(outcome.payout) : round2(Number(stake) * allOdds),
    totalOdds: outcome.totalOdds != null ? outcome.totalOdds : allOdds,
  };
}

export async function resettleBet(client, betId, legOutcomes, { dryRun = false, actorId = null } = {}) {
  if (!Array.isArray(legOutcomes) || legOutcomes.length === 0) throw new ResettleError('NO_LEGS', 'Zgjidh të paktën një leg');
  for (const l of legOutcomes) {
    if (!Number.isInteger(Number(l && l.id)) || !OUTCOMES.has(l && l.outcome)) throw new ResettleError('BAD_LEG', 'Çdo leg duhet id dhe rezultat (WON, LOST, VOID)');
  }

  const { rows: betRows } = await client.query('SELECT * FROM bets WHERE id = $1 FOR UPDATE', [betId]);
  const bet = betRows[0];
  if (!bet) throw new ResettleError('NOT_FOUND', 'Bileta nuk u gjet', 404);
  const { rows: legRows } = await client.query('SELECT * FROM bet_selections WHERE bet_id = $1 ORDER BY id', [betId]);

  const wanted = new Map(legOutcomes.map((l) => [Number(l.id), l.outcome]));
  for (const id of wanted.keys()) {
    if (!legRows.some((r) => Number(r.id) === id)) throw new ResettleError('LEG_NOT_ON_TICKET', `Legu ${id} nuk i përket kësaj bilete`);
  }
  const newLegs = legRows.map((r) => (wanted.has(Number(r.id)) ? { ...r, status: wanted.get(Number(r.id)) } : r));

  const now = worthNow(bet.stake, newLegs);
  if (!now) throw new ResettleError('UNDECIDED', 'Të gjitha legët duhet të kenë rezultat (asnjë nuk mund të mbetet i hapur)');

  const before = paidBefore(bet);
  const delta = round2(now.payout - before);

  const { rows: userRows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [bet.user_id]);
  if (!userRows[0]) throw new ResettleError('NO_USER', 'Përdoruesi i biletës nuk ekziston më', 404);
  const balanceBefore = round2(userRows[0].balance);
  const balanceAfter = round2(balanceBefore + delta);
  if (balanceAfter < 0) {
    throw new ResettleError('INSUFFICIENT_BALANCE',
      `Balanca e përdoruesit (${balanceBefore.toFixed(2)} L) nuk mjafton për të hequr ${Math.abs(delta).toFixed(2)} L. Nuk u ndryshua asgjë.`, 409);
  }

  const result = {
    betId: bet.id, userId: bet.user_id, fromStatus: bet.status, toStatus: now.status,
    paidBefore: before, worthNow: now.payout, delta, balanceBefore, balanceAfter, applied: false,
    legs: newLegs.map((l) => ({ id: Number(l.id), status: l.status })),
  };
  if (dryRun) return result;

  for (const [id, outcome] of wanted) {
    await client.query('UPDATE bet_selections SET status = $1 WHERE id = $2 AND bet_id = $3', [outcome, id, betId]);
  }
  await client.query('UPDATE bets SET status = $1, total_odds = $2, potential_return = $3 WHERE id = $4', [now.status, now.totalOdds, now.payout, betId]);
  if (delta !== 0) {
    await client.query('UPDATE users SET balance = $1 WHERE id = $2', [balanceAfter, bet.user_id]);
    await client.query(
      `INSERT INTO transactions
        (actor_id, source_id, target_id, amount, type, reference,
         source_balance_before, source_balance_after, target_balance_before, target_balance_after, created_at)
       VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$6,$7,$8)`,
      [actorId || bet.user_id, bet.user_id, Math.abs(delta), delta > 0 ? 'BET_RESETTLE_CREDIT' : 'BET_RESETTLE_DEBIT', betId, balanceBefore, balanceAfter, Date.now()]
    );
  }
  return { ...result, applied: true };
}
