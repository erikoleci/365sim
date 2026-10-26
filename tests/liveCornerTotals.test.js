import { describe, it, expect } from 'vitest';
import { getBetBlockReason, isLiveCornerTotals } from '../server/marketRules.js';
import { determineLegOutcome } from '../server/matchSettlement.js';

const NOW = Date.parse('2026-10-26T20:00:00Z');
const row = (over = {}) => ({
  status: 'LIVE', live_status: '2H', home_team: 'A', away_team: 'B',
  start_time: new Date(NOW - 70 * 60000).toISOString(), live_minute: '60:00',
  live_home_score: 0, live_away_score: 0,
  live_corners: { home: 4, away: 5, fresh: true },
  ...over,
});
const M = (name = 'Lart/Poshtë Korne Totali') => ({ id: 'l365-1-corners', name });
const S = (name) => ({ id: name, name });
const reason = (r, sel, name) => getBetBlockReason(r, M(name), S(sel), NOW);

describe('live corner totals', () => {
  it('recognises only the full-time corner totals markets', () => {
    expect(isLiveCornerTotals('Lart/Poshtë Korne')).toBe(true);
    expect(isLiveCornerTotals('Lart/Poshtë Korne Totali')).toBe(true);
    expect(isLiveCornerTotals('Lart/Poshtë Korne Pjesa 1-rë')).toBe(false);
    expect(isLiveCornerTotals('Lart/Poshtë Korne Totali Pjesa 1-rë')).toBe(false);
    expect(isLiveCornerTotals('Gara e Korneve')).toBe(false);
  });

  it('is open in play with a fresh counter when nothing is decided yet (9 corners)', () => {
    expect(reason(row(), 'Lart 10.5')).toBeNull();
    expect(reason(row(), 'Sakte 10')).toBeNull();
    expect(reason(row(), 'Poshte 9.5')).toBeNull();
    expect(reason(row(), 'Lart 12.5', 'Lart/Poshtë Korne')).toBeNull();
  });

  it('closes the options the count has already decided', () => {
    expect(reason(row(), 'Lart 8.5')).toBe('OUTCOME_DECIDED'); // 9 > 8.5: Over already won
    expect(reason(row(), 'Poshte 8.5')).toBe('OUTCOME_DECIDED'); // Under already lost
    expect(reason(row(), 'Sakte 8')).toBe('OUTCOME_DECIDED'); // more than 8 already
    expect(reason(row(), 'Sakte 9')).toBeNull(); // exactly 9 still possible
  });

  it('stays closed when the counter is missing, stale, or the end is too close', () => {
    expect(reason(row({ live_corners: undefined }), 'Lart 10.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row({ live_corners: { home: 4, away: 5, fresh: false } }), 'Lart 10.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row({ live_minute: '89:10' }), 'Lart 10.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row(), 'Ndoshta')).toBe('NOT_VERIFIABLE_LIVE'); // unknown option text
  });

  it('is unchanged before kick-off, and first-half corner markets still stay closed in play', () => {
    expect(reason(row({ status: 'UPCOMING', live_status: null, start_time: new Date(NOW + 3600000).toISOString(), live_corners: undefined }), 'Lart 10.5')).toBeNull();
    expect(reason(row(), 'Lart 6.5', 'Lart/Poshtë Korne Pjesa 1-rë')).not.toBeNull();
  });
});

describe('settling corner totals incl. exact', () => {
  const leg = (selection, market = 'Lart/Poshtë Korne Totali') => ({ market_id: 'l365-1-x', market_name: market, selection_id: selection, selection_name: selection });
  const ctx = (h, a) => ({ winner: 'HOME', totalGoals: 0, homeScore: 0, awayScore: 0, stats: { cornersHome: h, cornersAway: a } });
  it('Lart / Poshte / Sakte on the final corner count', () => {
    expect(determineLegOutcome(leg('Lart 10.5'), ctx(6, 5))).toBe('WON'); // 11
    expect(determineLegOutcome(leg('Poshte 9.5'), ctx(6, 5))).toBe('LOST');
    expect(determineLegOutcome(leg('Sakte 11'), ctx(6, 5))).toBe('WON');
    expect(determineLegOutcome(leg('Sakte 10'), ctx(6, 5))).toBe('LOST');
  });
});
