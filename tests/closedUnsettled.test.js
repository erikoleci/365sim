import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: a live match closed by the socket "delete-live-game" path used to be
// flipped to FINISHED with NO stored result and NO settlement, so its tickets sat
// "HAPUR" until the 24h overdue sweep VOIDed them. settleStuckBets() must now pick
// such matches up from their last real live score and decide the tickets.
const db = { bets: new Map(), legs: [], matches: new Map(), balances: new Map() };
const n = (sql) => sql.replace(/\s+/g, ' ').trim();

function client() {
  return {
    release() {},
    async query(sql, params = []) {
      const s = n(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };

      // step 0 of settleStuckBets: FINISHED, no result, real live score + clock, has PENDING legs
      if (s.startsWith('SELECT DISTINCT m.id, m.live_home_score')) {
        return {
          rows: [...db.matches.values()].filter((m) =>
            m.status === 'FINISHED' && (m.result_home == null || m.result_away == null) &&
            m.live_home_score != null && m.live_away_score != null &&
            m.live_minute != null && String(m.live_minute).trim() !== '' &&
            db.legs.some((l) => l.match_id === m.id && l.status === 'PENDING')),
        };
      }
      // settleMatch
      if (s.startsWith('SELECT * FROM matches_cache WHERE id')) return { rows: db.matches.has(params[0]) ? [{ ...db.matches.get(params[0]) }] : [] };
      if (s.startsWith("SELECT * FROM bet_selections WHERE match_id = $1 AND status = 'PENDING'")) {
        return { rows: db.legs.filter((l) => l.match_id === params[0] && l.status === 'PENDING').map((l) => ({ ...l })) };
      }
      if (s.startsWith('UPDATE bet_selections SET status = $1 WHERE id = $2')) {
        db.legs.find((l) => l.id === params[1]).status = params[0];
        return { rows: [] };
      }
      if (s.startsWith("UPDATE matches_cache SET status = 'FINISHED', result_home")) {
        Object.assign(db.matches.get(params[3]), { result_home: params[0], result_away: params[1], settled_at: params[2] });
        return { rows: [] };
      }
      // recomputeBetStatus
      if (s.startsWith('SELECT * FROM bets WHERE id')) return { rows: [{ ...db.bets.get(params[0]) }] };
      if (s.startsWith('SELECT * FROM bet_selections WHERE bet_id')) return { rows: db.legs.filter((l) => l.bet_id === params[0]).map((l) => ({ ...l })) };
      if (s.startsWith('UPDATE bets SET status = $1 WHERE id')) { db.bets.get(params[1]).status = params[0]; return { rows: [] }; }
      if (s.startsWith('UPDATE users SET balance = balance +')) {
        db.balances.set(params[1], (db.balances.get(params[1]) || 0) + Number(params[0]));
        return { rows: [] };
      }
      // main body of settleStuckBets
      if (s.startsWith('SELECT bs.*, m.result_home')) {
        return {
          rows: db.legs
            .filter((l) => l.status === 'PENDING' && db.matches.get(l.match_id)?.status === 'FINISHED' && db.matches.get(l.match_id).result_home != null)
            .map((l) => ({ ...l, ...db.matches.get(l.match_id) })),
        };
      }
      if (s.startsWith('SELECT b.id FROM bets b')) return { rows: [] };
      throw new Error('unmocked query: ' + s);
    },
  };
}
vi.mock('../server/db.js', () => ({ default: { connect: async () => client(), query: (...a) => client().query(...a) } }));
const { settleStuckBets } = await import('../server/matchSettlement.js');

const match = (id, o = {}) => db.matches.set(id, {
  id, status: 'FINISHED', result_home: null, result_away: null, settled_at: null,
  live_home_score: 2, live_away_score: 1, live_minute: '90', ht_home: null, ht_away: null, ...o,
});
const bet = (id) => db.bets.set(id, { id, user_id: 'u1', stake: 100, potential_return: 250, total_odds: 2.5, status: 'PENDING' });
let legId = 0;
const leg = (bet_id, match_id, selection_id) => db.legs.push({
  id: ++legId, bet_id, match_id, status: 'PENDING', odds: 2.5, market_id: match_id + '-h2h',
  market_name: 'Rezultat Final', selection_id, selection_name: selection_id, match_home: 'A', match_away: 'B',
});

describe('settleStuckBets: matches closed without settlement', () => {
  beforeEach(() => { db.bets.clear(); db.legs.length = 0; db.matches.clear(); db.balances.clear(); legId = 0; });

  it('pays a winning live ticket and closes a losing one from the last live score', async () => {
    match('m1'); // ended 2-1 (HOME), never settled
    bet('win'); leg('win', 'm1', 'HOME');
    bet('lose'); leg('lose', 'm1', 'AWAY');

    const r = await settleStuckBets();

    expect(r.closedUnsettled).toBe(1);
    expect(db.bets.get('win').status).toBe('WON');
    expect(db.bets.get('lose').status).toBe('LOST');
    expect(db.balances.get('u1')).toBe(250); // paid once, only the winner
    expect(db.matches.get('m1')).toMatchObject({ result_home: 2, result_away: 1 });
  });

  it('never settles a match that had no real live score/clock (no invented 0-0)', async () => {
    match('m2', { live_minute: null });
    bet('b'); leg('b', 'm2', 'HOME');

    const r = await settleStuckBets();

    expect(r.closedUnsettled).toBe(0);
    expect(db.bets.get('b').status).toBe('PENDING');
    expect(db.balances.size).toBe(0);
  });

  it('is idempotent: a second sweep does not pay again', async () => {
    match('m3'); bet('w'); leg('w', 'm3', 'HOME');
    await settleStuckBets();
    await settleStuckBets();
    expect(db.balances.get('u1')).toBe(250);
  });
});
