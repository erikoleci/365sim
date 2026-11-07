import { describe, it, expect } from 'vitest';
import { eventSourceIdFor, __resetLiveTwinCache } from '../server/liveTwin.js';

const row = { id: 'l365-1', home_team: 'University of Pretoria', away_team: 'Gomora United', start_time: '2026-11-07T13:00:00Z' };
const twin = { id: 'l365-2', home_team: 'Univ. Pretoria', away_team: 'Gomora United', start_time: '2026-11-07T13:00:00Z' };
const mk = (counts) => async (sql) => (/FROM match_events/.test(sql)
  ? { rows: Object.entries(counts).map(([match_id, n]) => ({ match_id, n })) }
  : { rows: [twin] });

describe('eventSourceIdFor', () => {
  it('uses the same-fixture record that holds the events', async () => {
    __resetLiveTwinCache();
    expect(await eventSourceIdFor(mk({ 'l365-2': 7 }), row)).toBe('l365-2');
  });
  it('keeps its own record when it has the events', async () => {
    __resetLiveTwinCache();
    expect(await eventSourceIdFor(mk({ 'l365-1': 5, 'l365-2': 3 }), row)).toBe('l365-1');
  });
  it('keeps its own record when nothing has events or the query fails', async () => {
    __resetLiveTwinCache();
    expect(await eventSourceIdFor(mk({}), row)).toBe('l365-1');
    __resetLiveTwinCache();
    expect(await eventSourceIdFor(async () => { throw new Error('x'); }, row)).toBe('l365-1');
  });
});
