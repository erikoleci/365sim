import { describe, it, expect } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';

// Final 2-1, half-time 1-0.
const ctx = { winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0 };
const leg = (market_name, sel) => ({ market_id: '', market_name, selection_id: sel, selection_name: sel, match_home: 'Elche CF', match_away: 'Valencia CF' });
const out = (m, s) => determineLegOutcome(leg(m, s), ctx);

describe('provider "Handikap" options as they really arrive', () => {
  it('reads the line from "1 -0.5" and "2 -0.25 (undefined)"', () => {
    expect(out('Handikap', '1 -0.5 (undefined)')).toBe('WON');   // 2-1 with -0.5: 1.5 - 1 > 0
    expect(out('Handikap', '1 -1.5 (undefined)')).toBe('LOST');  // 0.5 - 1 < 0
    expect(out('Handikap', '2 -0.5 (undefined)')).toBe('LOST');
    expect(out('Handikap', '1 -1')).toBe('VOID');                // push
    expect(out('Handikap', '1 -0.25')).toBe('WON');
  });
  it('still reads the old "(line)" form', () => {
    expect(out('Handikap', 'Elche CF (-0.5)')).toBe('WON');
  });
});

describe('Halftime/fulltime & exact goals, spelled-out form', () => {
  it('decides on goals + half-time + full-time', () => {
    expect(out('Halftime/fulltime & exact goals', '3 Home/Home')).toBe('WON');
    expect(out('Halftime/fulltime & exact goals', '3+ Home/Home')).toBe('WON');
    expect(out('Halftime/fulltime & exact goals', '1 Draw/Home')).toBe('LOST');
    expect(out('Halftime/fulltime & exact goals', '3 Draw/Home')).toBe('LOST');
    expect(out('Halftime/fulltime & exact goals', '0 Draw/Draw')).toBe('LOST');
  });
});
