import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory DB: bets, legs and matches, driven by the exact SQL the code issues.
const db = { bets: new Map(), legs: [], matches: new Map(), balances: new Map(), log: [] };
function client() {
  return {
    release() {},
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      db.log.push(s);
      if (s.startsWith('BEGIN') || s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) return { rows: [] };
      if (s.includes('FROM bet_selections bs JOIN bets b')) {
        return {
          rows: db.legs
            .filter((l) => l.status === 'PENDING' && db.bets.get(l.bet_id)?.status === 'PENDING')
            .map((l) => ({
              id: l.id, bet_id: l.bet_id, match_id: l.match_id, market_name: l.market_name, selection_name: l.selection_name,
              match_start: db.matches.get(l.match_id)?.start_time ?? null, bet_created_at: db.bets.get(l.bet_id).created_at,
            })),
        };
      }
      if (s.startsWith("UPDATE bet_selections SET status = 'VOID'")) {
        const leg = db.legs.find((l) => l.id === params[0] && l.status === 'PENDING');
        if (leg) leg.status = 'VOID';
        return { rows: [] };
      }
      // pg hands back copies, never the stored row itself
      if (s.startsWith('SELECT * FROM bets WHERE id')) return { rows: [{ ...db.bets.get(params[0]) }] };
      if (s.startsWith('SELECT * FROM bet_selections WHERE bet_id')) return { rows: db.legs.filter((l) => l.bet_id === params[0]).map((l) => ({ ...l })) };
      if (s.startsWith('UPDATE bets SET status = $1, total_odds')) {
        Object.assign(db.bets.get(params[3]), { status: params[0], total_odds: params[1], potential_return: params[2] });
        return { rows: [] };
      }
      if (s.startsWith('UPDATE bets SET status = $1 WHERE id')) { db.bets.get(params[1]).status = params[0]; return { rows: [] }; }
      if (s.startsWith('UPDATE users SET balance = balance +')) {
        db.balances.set(params[1], (db.balances.get(params[1]) || 0) + Number(params[0]));
        return { rows: [] };
      }
      throw new Error('unmocked query: ' + s);
    },
  };
}
vi.mock('../server/db.js', () => ({ default: { connect: async () => client(), query: (...a) => client().query(...a) } }));
const { voidOverdueLegs, isLegOverdue } = await import('../server/matchSettlement.js');

const NOW = Date.parse('2026-10-09T12:00:00Z');
const H = 3600 * 1000;
const iso = (offsetH) => new Date(NOW + offsetH * H).toISOString();
const bet = (id, o = {}) => db.bets.set(id, { id, user_id: 'u1', stake: 1000, potential_return: 2000, total_odds: 2, status: 'PENDING', created_at: NOW - 30 * H, ...o });
const leg = (id, bet_id, match_id, status = 'PENDING', odds = 2) => db.legs.push({ id, bet_id, match_id, status, odds, market_name: 'Tregu', selection_name: 'Zgjedhja' });
const match = (id, startOffsetH) => db.matches.set(id, { id, start_time: iso(startOffsetH) });

describe('isLegOverdue', () => {
  it('overdue once the match is older than the limit, never before', () => {
    expect(isLegOverdue({ matchStart: iso(-25) }, NOW, 24 * H)).toBe(true);
    expect(isLegOverdue({ matchStart: iso(-23) }, NOW, 24 * H)).toBe(false);
    expect(isLegOverdue({ matchStart: iso(+5) }, NOW, 24 * H)).toBe(false); // future match
  });
  it('no match row: falls back to the ticket date', () => {
    expect(isLegOverdue({ matchStart: null, betCreatedAt: NOW - 30 * H }, NOW, 24 * H)).toBe(true);
    expect(isLegOverdue({ matchStart: null, betCreatedAt: NOW - 2 * H }, NOW, 24 * H)).toBe(false);
  });
  it('a limit of 0 disables it', () => {
    expect(isLegOverdue({ matchStart: iso(-500) }, NOW, 0)).toBe(false);
  });
});

describe('voidOverdueLegs', () => {
  beforeEach(() => { db.bets.clear(); db.legs.length = 0; db.matches.clear(); db.balances.clear(); db.log.length = 0; });

  it('a single bet on a match that never resolved is voided and the stake refunded', async () => {
    match('m1', -30); bet('b1'); leg('l1', 'b1', 'm1');
    const r = await voidOverdueLegs({ olderThanMs: 24 * H, now: NOW });
    expect(r).toEqual({ voidedLegs: 1, recomputedBets: 1 });
    expect(db.bets.get('b1').status).toBe('VOID');
    expect(db.balances.get('u1')).toBe(1000);
  });

  it('accumulator: the overdue leg drops out, the won leg pays at its own odds', async () => {
    match('m1', -30); match('m2', -30); bet('b2', { potential_return: 6000, total_odds: 6 });
    leg('l1', 'b2', 'm1', 'PENDING', 3); leg('l2', 'b2', 'm2', 'WON', 2);
    await voidOverdueLegs({ olderThanMs: 24 * H, now: NOW });
    expect(db.bets.get('b2').status).toBe('WON');
    expect(db.balances.get('u1')).toBe(2000); // 1000 x 2, not x 6
  });

  it('accumulator with a lost leg stays lost, nothing is paid', async () => {
    match('m1', -30); match('m2', -30); bet('b3');
    leg('l1', 'b3', 'm1', 'PENDING'); leg('l2', 'b3', 'm2', 'LOST');
    await voidOverdueLegs({ olderThanMs: 24 * H, now: NOW });
    expect(db.bets.get('b3').status).toBe('LOST');
    expect(db.balances.get('u1')).toBeUndefined();
  });

  it('leaves tickets alone while a leg is on a match that is still to be played', async () => {
    match('m1', -30); match('m2', +10); bet('b4');
    leg('l1', 'b4', 'm1', 'PENDING'); leg('l2', 'b4', 'm2', 'PENDING');
    await voidOverdueLegs({ olderThanMs: 24 * H, now: NOW });
    expect(db.legs.find((l) => l.id === 'l1').status).toBe('VOID');
    expect(db.legs.find((l) => l.id === 'l2').status).toBe('PENDING');
    expect(db.bets.get('b4').status).toBe('PENDING'); // genuinely still open
  });

  it('does nothing recent, nothing for settled tickets, and nothing when disabled', async () => {
    match('m1', -3); bet('b5'); leg('l1', 'b5', 'm1');
    expect(await voidOverdueLegs({ olderThanMs: 24 * H, now: NOW })).toEqual({ voidedLegs: 0, recomputedBets: 0 });
    match('m9', -40); bet('b6', { status: 'LOST' }); leg('l9', 'b6', 'm9');
    expect((await voidOverdueLegs({ olderThanMs: 24 * H, now: NOW })).voidedLegs).toBe(0);
    expect((await voidOverdueLegs({ olderThanMs: 0, now: NOW })).disabled).toBe(true);
  });

  it('running it twice never pays twice', async () => {
    match('m1', -30); bet('b7'); leg('l1', 'b7', 'm1');
    await voidOverdueLegs({ olderThanMs: 24 * H, now: NOW });
    await voidOverdueLegs({ olderThanMs: 24 * H, now: NOW });
    expect(db.balances.get('u1')).toBe(1000);
  });
});
