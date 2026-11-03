import { describe, it, expect } from 'vitest';
import { describeOpenLeg, refineOpenLeg } from '../server/legWhy.js';
import { wouldSettleNow } from '../server/matchSettlement.js';

const match = { id: 'm1', home_team: 'A', away_team: 'B', status: 'FINISHED', result_home: 2, result_away: 1, start_time: new Date(Date.now() - 4 * 3600e3).toISOString() };
const leg = (market_name, selection_id) => ({ id: 1, match_id: 'm1', market_id: 'x-h2h-name', market_name, selection_id, selection_name: selection_id, match_home: 'A', match_away: 'B' });
const why = (l) => refineOpenLeg(describeOpenLeg({ leg: l, match }), { leg: l, match, decide: wouldSettleNow });

describe('"Pse është hapur?" says exactly why', () => {
  it('a plain final-result leg with a result is DECIDABLE_NOW: it closes by itself', () => {
    const r = why(leg('Rezultat Final', '1'));
    expect(r.code).toBe('DECIDABLE_NOW');
    expect(r.text).toMatch(/Mbyllet vetë/);
  });
  it('a market with no rule says it will NOT close by itself', () => {
    const r = why(leg('Tregu i Panjohur 123', 'po'));
    expect(r.code).toBe('NO_RULE');
    expect(r.text).toMatch(/NUK do mbyllet vetë/);
  });
});
