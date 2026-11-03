import { describe, it, expect } from 'vitest';
import { certainOutcomeReason } from '../server/liveCertainty.js';

const row = (h, a, extra = {}) => ({ id: '1', status: 'LIVE', live_status: '2H', live_home_score: h, live_away_score: a, ...extra });
const totals = (point, side = 'Over') => [{ id: 'm-totals', name: 'Gola Lart/Poshte' }, { id: `${side}-${point}`, name: `${side} ${point}` }];
const closed = (r, [m, s], stats) => certainOutcomeReason(r, m, s, stats);

describe('live certainty: a leg the situation already decided is closed', () => {
  it('Over 1.5 with 2 goals is closed, Over 2.5 is open', () => {
    expect(closed(row(1, 1), totals(1.5))).toBe('OUTCOME_DECIDED');
    expect(closed(row(1, 1), totals(2.5))).toBeNull();
  });
  it('Under 1.5 with 2 goals is closed (already lost)', () => {
    expect(closed(row(2, 0), totals(1.5, 'Under'))).toBe('OUTCOME_DECIDED');
  });
  it('both teams to score: closed once both scored (Yes won / No lost)', () => {
    const btts = (sel) => [{ id: 'm-btts', name: 'Dy skuadrat shenojne' }, { id: sel, name: sel }];
    expect(closed(row(1, 1), btts('Yes'))).toBe('OUTCOME_DECIDED');
    expect(closed(row(1, 1), btts('No'))).toBe('OUTCOME_DECIDED');
    expect(closed(row(1, 0), btts('Yes'))).toBeNull();
  });
  it('is silent before the match and with no live score', () => {
    expect(closed({ ...row(2, 0), status: 'UPCOMING', live_status: null }, totals(1.5))).toBeNull();
    expect(closed(row(null, null), totals(1.5))).toBeNull();
  });
  it('corner / card markets are judged only with counters', () => {
    const corners = [{ id: 'c', name: 'Total Korneve Lart/Poshte' }, { id: 'Over-8.5', name: 'Over 8.5' }];
    expect(closed(row(0, 0), corners)).toBeNull();
    expect(closed(row(0, 0), corners, { cornersHome: 6, cornersAway: 4, cardsHome: 0, cardsAway: 0 })).toBe('OUTCOME_DECIDED');
    expect(closed(row(0, 0), corners, { cornersHome: 3, cornersAway: 2, cardsHome: 0, cardsAway: 0 })).toBeNull();
  });
});
