import { describe, it, expect } from 'vitest';
import { auditMatch } from '../server/dayAudit.js';
const m = { home_team: 'A', away_team: 'B', status: 'FINISHED', result_home: 0, result_away: 0, live_home_score: 1, live_away_score: 1 };
describe('auditMatch', () => {
  it('flags a 0-0 result with goals in the timeline, a different live score and a Flashscore final', () => {
    const p = auditMatch(m, [{ type: 'GOAL', team: 'A', player: null }], null, { homeScore: 1, awayScore: 1, status: 'Finished' });
    expect(p.join('|')).toMatch(/differs from the last live score 1-1/);
    expect(p.join('|')).toMatch(/result 0-0 but the timeline has 1 goal/);
    expect(p.join('|')).toMatch(/without a scorer/);
    expect(p.join('|')).toMatch(/Flashscore final 1-1 differs/);
  });
  it('flags missing corner rows and is quiet for a consistent match', () => {
    expect(auditMatch({ ...m, live_home_score: 0, live_away_score: 0 }, [{ type: 'CORNER', team: 'home' }], { corners_home: 3, corners_away: 0 }, null).join('|')).toMatch(/home corners: 1 rows for a total of 3/);
    expect(auditMatch({ ...m, live_home_score: 0, live_away_score: 0 }, [], null, null)).toEqual([]);
  });
});
