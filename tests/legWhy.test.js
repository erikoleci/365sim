import { describe, it, expect } from 'vitest';
import { describeOpenLeg } from '../server/legWhy.js';

const NOW = Date.parse('2026-11-02T07:00:00Z');
const leg = { id: 1, match_id: 'm1', market_name: 'Numri i Golave në Ndeshje', selection_name: 'Lart 3.5' };
const m = (o) => ({ home_team: 'A', away_team: 'B', start_time: '2026-11-01T21:00:00Z', status: 'FINISHED', result_home: 2, result_away: 1, ...o });

describe('why is this leg still open', () => {
  it('match gone from the system', () => expect(describeOpenLeg({ leg, match: undefined, now: NOW }).code).toBe('MATCH_MISSING'));
  it('not started yet', () => expect(describeOpenLeg({ leg, match: m({ status: 'UPCOMING', start_time: '2026-11-02T09:00:00Z', result_home: null, result_away: null }), now: NOW }).code).toBe('NOT_STARTED'));
  it('in play', () => expect(describeOpenLeg({ leg, match: m({ status: 'LIVE', start_time: '2026-11-02T06:00:00Z', result_home: null, result_away: null, live_minute: "55'" }), now: NOW }).code).toBe('IN_PLAY'));
  it('hours after kickoff and never marked finished: stuck, close by hand', () => {
    const r = describeOpenLeg({ leg, match: m({ status: 'LIVE', result_home: null, result_away: null, live_home_score: 1, live_away_score: 1 }), now: NOW });
    expect(r.code).toBe('STUCK_NOT_FINISHED');
    expect(r.text).toContain('1-1');
  });
  it('finished without a result: gives the settle-block reason', () => {
    const r = describeOpenLeg({ leg, match: m({ result_home: null, result_away: null }), now: NOW, blockReason: 'no score was ever stored' });
    expect(r).toMatchObject({ code: 'NO_RESULT', text: 'no score was ever stored' });
  });
  it('result known but this market cannot be decided', () => expect(describeOpenLeg({ leg, match: m(), now: NOW }).code).toBe('NO_RULE_OR_DATA'));
});
