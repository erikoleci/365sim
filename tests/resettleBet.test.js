import { describe, it, expect } from 'vitest';
import { resettleBet, paidBefore, worthNow, ResettleError } from '../server/resettle.js';

// Tiny in-memory stand-in for the three tables the re-settlement touches.
function fakeDb({ bet, legs, balance }) {
  const state = { bet: { ...bet }, legs: legs.map((l) => ({ ...l })), balance, ledger: [] };
  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT * FROM bets WHERE id = $1 FOR UPDATE')) return { rows: params[0] === state.bet.id ? [state.bet] : [] };
      if (s.startsWith('SELECT * FROM bet_selections WHERE bet_id = $1')) return { rows: state.legs.map((l) => ({ ...l })) };
      if (s.startsWith('SELECT balance FROM users WHERE id = $1 FOR UPDATE')) return { rows: [{ balance: state.balance }] };
      if (s.startsWith('UPDATE bet_selections SET status = $1 WHERE id = $2 AND bet_id = $3')) {
        state.legs.find((l) => Number(l.id) === Number(params[1])).status = params[0];
        return { rows: [] };
      }
      if (s.startsWith('UPDATE bets SET status = $1, total_odds = $2, potential_return = $3 WHERE id = $4')) {
        Object.assign(state.bet, { status: params[0], total_odds: params[1], potential_return: params[2] });
        return { rows: [] };
      }
      if (s.startsWith('UPDATE users SET balance = $1 WHERE id = $2')) { state.balance = params[0]; return { rows: [] }; }
      if (s.startsWith('INSERT INTO transactions')) { state.ledger.push({ actor: params[0], user: params[1], amount: params[2], type: params[3], reference: params[4], before: params[5], after: params[6] }); return { rows: [] }; }
      throw new Error('unmocked query: ' + s);
    },
  };
  return { client, state };
}

// The ticket from the report: 3 legs, all refunded by the overdue rule, 1000 L stake refunded.
const voidedTicket = () => fakeDb({
  bet: { id: 'bet-1', user_id: 'u1', stake: 1000, total_odds: 1, potential_return: 1000, status: 'VOID' },
  legs: [
    { id: 11, bet_id: 'bet-1', odds: 2.68, status: 'VOID' },
    { id: 12, bet_id: 'bet-1', odds: 7.95, status: 'VOID' },
    { id: 13, bet_id: 'bet-1', odds: 2.1, status: 'VOID' },
  ],
  balance: 5000,
});

describe('resettleBet', () => {
  it('a refunded ticket whose first leg lost becomes LOST and the refund is taken back', async () => {
    const { client, state } = voidedTicket();
    const r = await resettleBet(client, 'bet-1', [{ id: 11, outcome: 'LOST' }], { actorId: 'super-1' });
    expect(r).toMatchObject({ fromStatus: 'VOID', toStatus: 'LOST', paidBefore: 1000, worthNow: 0, delta: -1000, balanceBefore: 5000, balanceAfter: 4000, applied: true });
    expect(state.bet.status).toBe('LOST');
    expect(state.balance).toBe(4000);
    expect(state.legs.map((l) => l.status)).toEqual(['LOST', 'VOID', 'VOID']); // legs not listed keep their status
    expect(state.ledger).toEqual([{ actor: 'super-1', user: 'u1', amount: 1000, type: 'BET_RESETTLE_DEBIT', reference: 'bet-1', before: 5000, after: 4000 }]);
  });

  it('dryRun reports the effect and changes nothing', async () => {
    const { client, state } = voidedTicket();
    const r = await resettleBet(client, 'bet-1', [{ id: 11, outcome: 'LOST' }], { dryRun: true });
    expect(r).toMatchObject({ toStatus: 'LOST', delta: -1000, balanceAfter: 4000, applied: false });
    expect(state.bet.status).toBe('VOID');
    expect(state.balance).toBe(5000);
    expect(state.ledger).toHaveLength(0);
  });

  it('refuses when the player no longer has the money, and changes nothing', async () => {
    const { client, state } = voidedTicket();
    state.balance = 400;
    await expect(resettleBet(client, 'bet-1', [{ id: 11, outcome: 'LOST' }])).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 409 });
    expect(state.bet.status).toBe('VOID');
    expect(state.balance).toBe(400);
    expect(state.legs[0].status).toBe('VOID');
    expect(state.ledger).toHaveLength(0);
  });

  it('a paid WON ticket turned LOST takes the whole payout back', async () => {
    const { client, state } = fakeDb({
      bet: { id: 'bet-2', user_id: 'u1', stake: 1000, total_odds: 2.68, potential_return: 2680, status: 'WON' },
      legs: [{ id: 21, bet_id: 'bet-2', odds: 2.68, status: 'WON' }],
      balance: 3000,
    });
    const r = await resettleBet(client, 'bet-2', [{ id: 21, outcome: 'LOST' }]);
    expect(r).toMatchObject({ toStatus: 'LOST', delta: -2680, balanceAfter: 320 });
    expect(state.ledger[0].type).toBe('BET_RESETTLE_DEBIT');
  });

  it('a LOST ticket that really won pays the winnings (credit row)', async () => {
    const { client, state } = fakeDb({
      bet: { id: 'bet-3', user_id: 'u1', stake: 100, total_odds: 6, potential_return: 600, status: 'LOST' },
      legs: [{ id: 31, bet_id: 'bet-3', odds: 2, status: 'LOST' }, { id: 32, bet_id: 'bet-3', odds: 3, status: 'WON' }],
      balance: 0,
    });
    const r = await resettleBet(client, 'bet-3', [{ id: 31, outcome: 'WON' }]);
    expect(r).toMatchObject({ toStatus: 'WON', worthNow: 600, delta: 600, balanceAfter: 600 });
    expect(state.ledger[0]).toMatchObject({ type: 'BET_RESETTLE_CREDIT', amount: 600 });
  });

  it('a refunded ticket whose legs all won is paid on the legs that count (a void leg drops out)', async () => {
    const { client, state } = voidedTicket();
    const r = await resettleBet(client, 'bet-1', [{ id: 11, outcome: 'WON' }, { id: 12, outcome: 'WON' }]); // leg 13 stays VOID
    expect(r.toStatus).toBe('WON');
    expect(r.worthNow).toBeCloseTo(1000 * 2.68 * 7.95, 2);
    expect(r.delta).toBeCloseTo(1000 * 2.68 * 7.95 - 1000, 2);
    expect(state.bet.status).toBe('WON');
  });

  it('is idempotent: doing the same change twice moves the money once', async () => {
    const { client, state } = voidedTicket();
    await resettleBet(client, 'bet-1', [{ id: 11, outcome: 'LOST' }]);
    const again = await resettleBet(client, 'bet-1', [{ id: 11, outcome: 'LOST' }]);
    expect(again.delta).toBe(0);
    expect(state.balance).toBe(4000);
    expect(state.ledger).toHaveLength(1);
  });

  it('rejects an undecided result, an unknown leg and an unknown ticket', async () => {
    const { client } = fakeDb({
      bet: { id: 'bet-4', user_id: 'u1', stake: 10, total_odds: 4, potential_return: 40, status: 'PENDING' },
      legs: [{ id: 41, bet_id: 'bet-4', odds: 2, status: 'PENDING' }, { id: 42, bet_id: 'bet-4', odds: 2, status: 'PENDING' }],
      balance: 0,
    });
    await expect(resettleBet(client, 'bet-4', [{ id: 41, outcome: 'WON' }])).rejects.toMatchObject({ code: 'UNDECIDED' });
    await expect(resettleBet(client, 'bet-4', [{ id: 99, outcome: 'WON' }])).rejects.toMatchObject({ code: 'LEG_NOT_ON_TICKET' });
    await expect(resettleBet(client, 'nope', [{ id: 41, outcome: 'WON' }])).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(resettleBet(client, 'bet-4', [{ id: 41, outcome: 'MAYBE' }])).rejects.toBeInstanceOf(ResettleError);
  });
});

describe('paidBefore / worthNow', () => {
  it('paidBefore: WON -> stored return, VOID -> stake, LOST / PENDING -> 0', () => {
    expect(paidBefore({ status: 'WON', stake: 10, potential_return: 40 })).toBe(40);
    expect(paidBefore({ status: 'VOID', stake: 10, potential_return: 40 })).toBe(10);
    expect(paidBefore({ status: 'LOST', stake: 10, potential_return: 40 })).toBe(0);
    expect(paidBefore({ status: 'PENDING', stake: 10, potential_return: 40 })).toBe(0);
  });
  it('worthNow: all legs void is a refund; undecided is null', () => {
    expect(worthNow(10, [{ odds: 2, status: 'VOID' }])).toMatchObject({ status: 'VOID', payout: 10 });
    expect(worthNow(10, [{ odds: 2, status: 'PENDING' }])).toBeNull();
  });
});
