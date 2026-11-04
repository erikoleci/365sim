import { describe, it, expect } from 'vitest';
import { isLostForSure, sureOutcome } from '../server/matchSettlement.js';

const leg = (market_id, market_name, selection_id, selection_name = selection_id) => ({ market_id, market_name, selection_id, selection_name, match_home: 'Shakhtar', match_away: 'Sporting' });

describe('isLostForSure (in-play loss)', () => {
  it('Under 2.5 is lost at 3 goals, still alive at 2', () => {
    expect(isLostForSure(leg('m-totals', 'Total Goals', 'Under-2.5'), { h: 2, a: 1 })).toBe(true);
    expect(isLostForSure(leg('m-totals', 'Total Goals', 'Under-2.5'), { h: 1, a: 1 })).toBe(false);
  });
  it('Over 2.5 is never lost early', () => {
    expect(isLostForSure(leg('m-totals', 'Total Goals', 'Over-2.5'), { h: 0, a: 0 })).toBe(false);
  });
  it('BTTS No is lost once both teams scored; BTTS Yes never lost early', () => {
    expect(isLostForSure(leg('m-btts', 'Both teams to score', 'No'), { h: 1, a: 1 })).toBe(true);
    expect(isLostForSure(leg('m-btts', 'Both teams to score', 'No'), { h: 1, a: 0 })).toBe(false);
    expect(isLostForSure(leg('m-btts', 'Both teams to score', 'Yes'), { h: 0, a: 0 })).toBe(false);
  });
  it('a home win is not lost when the away team leads (comeback possible)', () => {
    expect(isLostForSure(leg('m-h2h', 'Match Winner', 'HOME'), { h: 0, a: 3 })).toBe(false);
  });
  it('a whole-line total landing on the line is a push, not lost', () => {
    expect(isLostForSure(leg('m-totals', 'Total Goals', 'Under-2'), { h: 1, a: 1 })).toBe(false);
  });
  it('Under corners is lost once the line is passed, not before', () => {
    const l = leg('x', 'Total Korne', 'Under 9.5', 'Poshtë 9.5');
    expect(isLostForSure(l, { h: 0, a: 0 }, { cornersHome: 6, cornersAway: 4, cardsHome: 0, cardsAway: 0 })).toBe(true);
    expect(isLostForSure(l, { h: 0, a: 0 }, { cornersHome: 5, cornersAway: 4, cardsHome: 0, cardsAway: 0 })).toBe(false);
  });
  it('Over corners is never lost early', () => {
    const l = leg('x', 'Total Korne', 'Over 9.5', 'Lart 9.5');
    expect(isLostForSure(l, { h: 0, a: 0 }, { cornersHome: 1, cornersAway: 0, cardsHome: 0, cardsAway: 0 })).toBe(false);
  });
  it('certain wins are recognised: Over 2.5 at 3 goals, BTTS Yes once both scored', () => {
    expect(sureOutcome(leg('m-totals', 'Total Goals', 'Over-2.5'), { h: 2, a: 1 })).toBe('WON');
    expect(sureOutcome(leg('m-totals', 'Total Goals', 'Over-2.5'), { h: 1, a: 1 })).toBe(null);
    expect(sureOutcome(leg('m-btts', 'Both teams to score', 'Yes'), { h: 1, a: 1 })).toBe('WON');
    expect(sureOutcome(leg('m-totals', 'Total Goals', 'Under-2.5'), { h: 2, a: 1 })).toBe('LOST');
    expect(sureOutcome(leg('m-h2h', 'Match Winner', 'HOME'), { h: 3, a: 0 })).toBe(null);
  });
});

describe('canSettleFromLiveScore: frozen clock projected forward', () => {
  it('a match frozen at 61 for 35 minutes can be settled, one silent for 10 minutes cannot', async () => {
    const { canSettleFromLiveScore } = await import('../server/matchSettlement.js');
    const now = Date.now();
    const base = { live_home_score: 0, live_away_score: 2, live_minute: "61'", start_time: new Date(now - 100 * 60000).toISOString() };
    expect(canSettleFromLiveScore({ ...base, live_minute_updated_at: now - 35 * 60000 }, now)).toBe(true);
    expect(canSettleFromLiveScore({ ...base, live_minute_updated_at: now - 10 * 60000 }, now)).toBe(false);
  });
});
