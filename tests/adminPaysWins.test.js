import { describe, it, expect, afterEach } from 'vitest';
import { recomputeBetStatus, refundAdminForWin } from '../server/matchSettlement.js';

// Stateful fake pg client: balances per user, the ledger rows, one bet and its legs, and who owns the player.
function world({ bet, legs, owner = { id: 'adm1', role: 'ADMIN' }, balances = { u1: 5000, adm1: 100000 } }) {
  const b = { ...balances };
  const ledger = [];
  return {
    b, ledger,
    async query(sql, params) {
      if (/FROM bets WHERE id/.test(sql)) return { rows: [bet] };
      if (/FROM bet_selections WHERE bet_id/.test(sql)) return { rows: legs };
      if (/FROM users u LEFT JOIN users ag/.test(sql)) return { rows: owner && params[0] === 'u1' ? [{ id: owner.id }] : [] };
      let m = sql.match(/SELECT (balance|balance_eur) FROM users WHERE id/);
      if (m) return { rows: params[0] in b ? [{ [m[1]]: b[params[0]] }] : [] };
      if (/UPDATE users SET balance(_eur)? = /.test(sql)) { b[params[1]] += params[0]; return { rows: [] }; }
      if (/INSERT INTO transactions/.test(sql)) { ledger.push({ amount: params[1], type: params[2], ref: params[3], user: params[0] }); return { rows: [] }; }
      if (/FROM transactions\s+WHERE reference/.test(sql)) {
        const per = new Map();
        for (const r of ledger) if (r.ref === params[0] && /^ADMIN_/.test(r.type)) per.set(r.user, (per.get(r.user) || 0) + r.amount);
        return { rows: [...per].map(([admin_id, net]) => ({ admin_id, net })) };
      }
      return { rows: [] };
    },
  };
}
const bet = (o = {}) => ({ id: 'b1', user_id: 'u1', stake: 1000, potential_return: 6000, status: 'PENDING', currency: 'ALL', ...o });
const won = [{ status: 'WON', odds: 2 }, { status: 'WON', odds: 3 }];

afterEach(() => { delete process.env.ADMIN_PAYS_WINS; });

describe('winnings come out of the owner admin (switch ADMIN_PAYS_WINS)', () => {
  it('switch OFF (default): the player is paid and nobody else is touched', async () => {
    const w = world({ bet: bet(), legs: won });
    await recomputeBetStatus('b1', w);
    expect(w.b).toEqual({ u1: 11000, adm1: 100000 });
    expect(w.ledger.map((r) => r.type)).toEqual(['BET_WIN_PAYOUT']);
  });
  it('switch ON: the same amount is taken off the admin', async () => {
    process.env.ADMIN_PAYS_WINS = '1';
    const w = world({ bet: bet(), legs: won });
    await recomputeBetStatus('b1', w);
    expect(w.b).toEqual({ u1: 11000, adm1: 94000 });
    expect(w.ledger).toEqual([
      { amount: 6000, type: 'BET_WIN_PAYOUT', ref: 'b1', user: 'u1' },
      { amount: -6000, type: 'ADMIN_PAYS_WIN', ref: 'b1', user: 'adm1' },
    ]);
  });
  it('not enough credit: the player is STILL paid and the admin goes negative (never blocked)', async () => {
    process.env.ADMIN_PAYS_WINS = '1';
    const w = world({ bet: bet(), legs: won, balances: { u1: 0, adm1: 1000 } });
    await recomputeBetStatus('b1', w);
    expect(w.b.u1).toBe(6000);
    expect(w.b.adm1).toBe(-5000);
  });
  it('a player of the super admin (no admin) costs nobody', async () => {
    process.env.ADMIN_PAYS_WINS = '1';
    const w = world({ bet: bet(), legs: won, owner: null });
    await recomputeBetStatus('b1', w);
    expect(w.ledger.map((r) => r.type)).toEqual(['BET_WIN_PAYOUT']);
  });
  it('a ticket that is lost, or already paid, charges nobody', async () => {
    process.env.ADMIN_PAYS_WINS = '1';
    const lost = world({ bet: bet(), legs: [{ status: 'LOST', odds: 2 }] });
    await recomputeBetStatus('b1', lost);
    expect(lost.ledger).toEqual([]);
    const paid = world({ bet: bet({ status: 'WON' }), legs: won });
    await recomputeBetStatus('b1', paid);
    expect(paid.ledger).toEqual([]);
    expect(paid.b.adm1).toBe(100000);
  });
  it('a euro ticket is charged on the euro wallet', async () => {
    process.env.ADMIN_PAYS_WINS = '1';
    const w = world({ bet: bet({ currency: 'EUR', stake: 50, potential_return: 500 }), legs: [{ status: 'WON', odds: 10 }] });
    await recomputeBetStatus('b1', w);
    expect(w.ledger.find((r) => r.type === 'ADMIN_PAYS_WIN').amount).toBe(-500);
  });
});

describe('refundAdminForWin', () => {
  it('gives back exactly what the win cost, once', async () => {
    process.env.ADMIN_PAYS_WINS = '1';
    const w = world({ bet: bet(), legs: won });
    await recomputeBetStatus('b1', w);
    await refundAdminForWin(w, bet({ status: 'WON' }));
    expect(w.b.adm1).toBe(100000);
    await refundAdminForWin(w, bet({ status: 'WON' })); // a second call gives nothing more
    expect(w.b.adm1).toBe(100000);
  });
  it('does nothing for an old ticket that never cost the admin anything (works with the switch off)', async () => {
    const w = world({ bet: bet({ status: 'WON' }), legs: won });
    await refundAdminForWin(w, bet({ status: 'WON' }));
    expect(w.b.adm1).toBe(100000);
    expect(w.ledger).toEqual([]);
  });
});
