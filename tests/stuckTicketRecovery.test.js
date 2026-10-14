import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { bets: new Map(), legs: [], balances: new Map() };
function client() {
  return {
    release() {},
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT bs.bet_id, bs.status FROM bet_selections bs JOIN bets b')) {
        return { rows: db.legs.filter((l) => db.bets.get(l.bet_id)?.status === 'PENDING').map((l) => ({ bet_id: l.bet_id, status: l.status })) };
      }
      if (s.startsWith('SELECT * FROM bets WHERE id')) return { rows: [{ ...db.bets.get(params[0]) }] };
      if (s.startsWith('SELECT * FROM bet_selections WHERE bet_id')) return { rows: db.legs.filter((l) => l.bet_id === params[0]).map((l) => ({ ...l })) };
      if (s.startsWith('UPDATE bets SET status = $1, total_odds')) { Object.assign(db.bets.get(params[3]), { status: params[0], total_odds: params[1], potential_return: params[2] }); return { rows: [] }; }
      if (s.startsWith('UPDATE bets SET status = $1 WHERE id')) { db.bets.get(params[1]).status = params[0]; return { rows: [] }; }
      if (s.startsWith('UPDATE users SET balance = balance +')) { db.balances.set(params[1], (db.balances.get(params[1]) || 0) + Number(params[0])); return { rows: [] }; }
      throw new Error('unmocked query: ' + s);
    },
  };
}
vi.mock('../server/db.js', () => ({ default: { connect: async () => client(), query: (...a) => client().query(...a) } }));
const { findDecidedPendingTickets, recomputeBetStatus } = await import('../server/matchSettlement.js');

const bet = (id, o = {}) => db.bets.set(id, { id, user_id: 'u1', stake: 1000, potential_return: 6000, total_odds: 6, status: 'PENDING', ...o });
const leg = (id, bet_id, status, odds = 2) => db.legs.push({ id, bet_id, status, odds });

async function sweep() {
  const c = client();
  for (const id of await findDecidedPendingTickets(c)) await recomputeBetStatus(id, c);
}

describe('stuck ticket recovery', () => {
  beforeEach(() => { db.bets.clear(); db.legs.length = 0; db.balances.clear(); });

  it('a ticket with one LOST leg and others still open is closed as LOST, nothing paid', async () => {
    bet('b1'); leg('l1', 'b1', 'LOST'); leg('l2', 'b1', 'PENDING'); leg('l3', 'b1', 'WON');
    await sweep();
    expect(db.bets.get('b1').status).toBe('LOST');
    expect(db.balances.get('u1')).toBeUndefined();
  });
  it('a ticket whose legs all won is paid once, even if the sweep runs twice', async () => {
    bet('b2'); leg('l1', 'b2', 'WON'); leg('l2', 'b2', 'WON');
    await sweep(); await sweep();
    expect(db.bets.get('b2').status).toBe('WON');
    expect(db.balances.get('u1')).toBe(6000);
  });
  it('a ticket still waiting on a leg that has not been played stays open', async () => {
    bet('b3'); leg('l1', 'b3', 'WON'); leg('l2', 'b3', 'PENDING');
    await sweep();
    expect(db.bets.get('b3').status).toBe('PENDING');
  });
  it('several tickets are each decided on their own legs', async () => {
    bet('a'); leg('a1', 'a', 'LOST'); leg('a2', 'a', 'PENDING');
    bet('b'); leg('b1', 'b', 'WON'); leg('b2', 'b', 'WON');
    bet('c'); leg('c1', 'c', 'WON'); leg('c2', 'c', 'PENDING');
    await sweep();
    expect([db.bets.get('a').status, db.bets.get('b').status, db.bets.get('c').status]).toEqual(['LOST', 'WON', 'PENDING']);
  });
});
