import { describe, it, expect } from 'vitest';
import { loadMatchStats, loadHtStats } from '../server/matchSettlement.js';

// A client that answers the three queries the loaders make, from fixed data.
const fakeClient = ({ stats, events }) => ({
  async query(sql) {
    const s = String(sql);
    if (s.includes('FROM live_statistics')) return { rows: stats ? [stats] : [] };
    if (s.includes('GROUP BY type, team, half') || s.includes('GROUP BY type, team')) return { rows: events };
    if (s.includes('SELECT 1 FROM match_events')) return { rows: events.length ? [{ '?column?': 1 }] : [] };
    throw new Error('unexpected query: ' + s);
  },
});
const ev = [
  { type: 'CORNER', team: 'home', half: 1, total: 3, n: 3 }, { type: 'CORNER', team: 'home', half: 2, total: 6, n: 3 },
  { type: 'CORNER', team: 'away', half: 1, total: 2, n: 2 }, { type: 'CORNER', team: 'away', half: 2, total: 4, n: 2 },
  { type: 'YELLOW_CARD', team: 'home', half: 2, total: 2, n: 2 }, { type: 'RED_CARD', team: 'away', half: 2, total: 1, n: 1 },
];

describe('corner / card totals fall back to the match events (Ngjarjet)', () => {
  it('no stats row: totals come from the events (running total per side), cards = yellow + red', async () => {
    const st = await loadMatchStats(fakeClient({ stats: null, events: ev }), 'm1');
    expect(st).toMatchObject({ cornersHome: 6, cornersAway: 4, yellowHome: 2, yellowAway: 0, redAway: 1, cardsHome: 2, cardsAway: 1 });
  });
  it('the stored counters win over the events', async () => {
    const st = await loadMatchStats(fakeClient({ stats: { corners_home: 9, corners_away: 7, cards_home: 1, cards_away: 0, yellow_home: 1, yellow_away: 0, red_home: 0, red_away: 0 }, events: ev }), 'm1');
    expect(st).toMatchObject({ cornersHome: 9, cornersAway: 7 });
  });
  it('a match with no events and no stats stays unknown (settles later, never as 0)', async () => {
    expect(await loadMatchStats(fakeClient({ stats: null, events: [] }), 'm1')).toBeUndefined();
  });
  it('half-time totals come from the first-half events when no snapshot was taken', async () => {
    const ht = await loadHtStats(fakeClient({ stats: null, events: ev }), 'm1', {});
    expect(ht).toMatchObject({ cornersHome: 3, cornersAway: 2, cardsHome: 0 });
  });
});
