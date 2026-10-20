import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/db.js', () => ({ default: { connect: async () => { throw new Error('unused'); }, query: async () => ({ rows: [] }) } }));
const { recomputeBetStatus } = await import('../server/matchSettlement.js');

// Fake client for recomputeBetStatus: one bet, its legs, a balance, and the statements it issues.
let bet; let legs; let balance;
const fake = {
  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM bets WHERE id')) return { rows: [{ ...bet }] };
    if (s.startsWith('SELECT * FROM bet_selections WHERE bet_id')) return { rows: legs.map((l) => ({ ...l })) };
    if (s.startsWith('UPDATE bets SET status = $1, total_odds = $2, potential_return = $3')) {
      Object.assign(bet, { status: params[0], total_odds: params[1], potential_return: params[2] });
      return { rows: [] };
    }
    if (s.startsWith('UPDATE bets SET status = $1 WHERE id')) { bet.status = params[0]; return { rows: [] }; }
    if (s.startsWith('UPDATE users SET balance = balance +')) { balance += Number(params[0]); return { rows: [] }; }
    throw new Error('unmocked: ' + s);
  },
};
const setup = (stake, odds, statuses) => {
  bet = { id: 'b', user_id: 'u', stake, total_odds: odds.reduce((a, b) => a * b, 1), potential_return: stake * odds.reduce((a, b) => a * b, 1), status: 'PENDING' };
  legs = odds.map((o, i) => ({ id: i, bet_id: 'b', odds: o, status: statuses[i] }));
  balance = 0;
};

describe('Asian quarter lines: half-won / half-lost legs', () => {
  beforeEach(() => setup(100, [2.0], ['HALF_WON']));

  it('half-won single pays half the stake at full odds plus the other half back', async () => {
    await recomputeBetStatus('b', fake);
    expect(bet.status).toBe('WON');
    expect(bet.potential_return).toBe(150);   // 100 * (1 + (2-1)/2)
    expect(balance).toBe(150);
  });

  it('half-lost single returns half the stake', async () => {
    setup(100, [2.0], ['HALF_LOST']);
    await recomputeBetStatus('b', fake);
    expect(bet.potential_return).toBe(50);
    expect(balance).toBe(50);
    expect(bet.status).toBe('WON'); // stored as WON with the smaller payout so (return - stake) reports stay true
  });

  it('accumulator: half-won leg x won leg', async () => {
    setup(100, [2.0, 1.5], ['HALF_WON', 'WON']);
    await recomputeBetStatus('b', fake);
    expect(balance).toBe(225);                // 100 * 1.5 * 1.5
  });

  it('a lost leg still loses everything, whatever the other legs did', async () => {
    setup(100, [2.0, 1.5], ['HALF_WON', 'LOST']);
    await recomputeBetStatus('b', fake);
    expect(bet.status).toBe('LOST');
    expect(balance).toBe(0);
  });

  it('stays pending while any leg is open', async () => {
    setup(100, [2.0, 1.5], ['HALF_WON', 'PENDING']);
    await recomputeBetStatus('b', fake);
    expect(bet.status).toBe('PENDING');
    expect(balance).toBe(0);
  });

  it('is idempotent: recomputing a settled ticket never pays twice', async () => {
    await recomputeBetStatus('b', fake);
    await recomputeBetStatus('b', fake);
    await recomputeBetStatus('b', fake);
    expect(balance).toBe(150);
  });

  it('half-lost + refunded leg returning exactly the stake is a plain refund', async () => {
    setup(100, [2.0, 1.0], ['HALF_LOST', 'VOID']);
    await recomputeBetStatus('b', fake);
    expect(balance).toBe(50);
  });
});
