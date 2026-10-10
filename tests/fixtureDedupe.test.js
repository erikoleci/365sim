import { describe, it, expect } from 'vitest';
import { dedupeMatches, sameFixture, teamQualifier } from '../server/fixtureDedupe.js';

const START = '2026-10-10T14:00:00.000Z';
const opt = (n) => Array.from({ length: n }, (_, i) => ({ id: 'o' + i, odds: 2 }));
const base = (o) => ({ startTime: START, status: 'LIVE', markets: [], ...o });

// The same real fixture under two provider ids: the pre-match catalogue record (many markets,
// no live data, shown LIVE only because kickoff has passed) and the in-play record (live data).
const catalogue = base({
  id: 'l365-5122706', homeTeam: 'Chelsea', awayTeam: 'Bournemouth',
  markets: [{ options: opt(40) }],
  currentMinute: '72', currentMinuteEstimated: true, // wall-clock guess, no provider data
});
const inplay = base({
  id: 'l365-5200421', homeTeam: 'Chelsea', awayTeam: 'Bournemouth',
  markets: [{ options: opt(3) }],
  liveHomeScore: 5, liveAwayScore: 1, currentMinute: '75:39', currentMinuteUpdatedAt: 1791646491714, liveStatus: '3',
});

describe('dedupeMatches - same fixture under two provider ids', () => {
  it('keeps the richer odds but takes score/minute/status from the record that has real live data', () => {
    const [m] = dedupeMatches([catalogue, inplay]);
    expect(m.id).toBe('l365-5122706');
    expect(m.liveHomeScore).toBe(5);
    expect(m.liveAwayScore).toBe(1);
    expect(m.currentMinute).toBe('75:39');
    expect(m.currentMinuteEstimated).toBeUndefined();
    expect(m.currentMinuteUpdatedAt).toBe(1791646491714);
    expect(m.liveStatus).toBe('3');
    expect(m.liveSourceId).toBe('l365-5200421');
  });

  it('gives the same result whichever order the rows arrive in', () => {
    const [a] = dedupeMatches([inplay, catalogue]);
    const [b] = dedupeMatches([catalogue, inplay]);
    expect(a).toEqual(b);
  });

  it('a real provider 0-0 is live data (not treated as missing) and beats an empty duplicate', () => {
    const zero = { ...inplay, liveHomeScore: 0, liveAwayScore: 0 };
    const [m] = dedupeMatches([catalogue, zero]);
    expect(m.liveHomeScore).toBe(0);
    expect(m.liveAwayScore).toBe(0);
  });

  it('never mixes the home score of one record with the away score of another', () => {
    const half = { ...catalogue, liveHomeScore: 2 }; // lone half-score on the empty record
    const [m] = dedupeMatches([half, inplay]);
    expect([m.liveHomeScore, m.liveAwayScore]).toEqual([5, 1]);
  });

  it('leaves a single record untouched (no liveSourceId)', () => {
    const [m] = dedupeMatches([inplay]);
    expect(m.liveSourceId).toBeUndefined();
    expect(m.liveHomeScore).toBe(5);
  });

  it('reports the merged ids so they can be logged', () => {
    const seen = [];
    dedupeMatches([catalogue, inplay], (ids, kept, src) => seen.push({ ids: ids.sort(), kept, src }));
    expect(seen).toEqual([{ ids: ['l365-5122706', 'l365-5200421'], kept: 'l365-5122706', src: 'l365-5200421' }]);
  });
});

describe('fixture identity - similar team names must not merge different fixtures', () => {
  it("a men's match is not merged with the women's / youth / reserve match of the same clubs", () => {
    const men = base({ id: 'l365-1', homeTeam: 'Chelsea', awayTeam: 'Bournemouth', liveHomeScore: 5, liveAwayScore: 1 });
    const women = base({ id: 'l365-2', homeTeam: 'Chelsea W', awayTeam: 'Bournemouth W', liveHomeScore: 0, liveAwayScore: 0 });
    const u21 = base({ id: 'l365-3', homeTeam: 'Chelsea U21', awayTeam: 'Bournemouth U21', liveHomeScore: 1, liveAwayScore: 1 });
    const res = dedupeMatches([men, women, u21]);
    expect(res.map((m) => m.id).sort()).toEqual(['l365-1', 'l365-2', 'l365-3']);
    expect(res.find((m) => m.id === 'l365-1').liveHomeScore).toBe(5);
  });

  it('qualifiers are detected', () => {
    expect(teamQualifier('Chelsea')).toBe('');
    expect(teamQualifier('Chelsea W')).toBe('w');
    expect(teamQualifier('Chelsea Women')).toBe('women');
    expect(teamQualifier('Chelsea U21')).toBe('u21');
    expect(teamQualifier('Chelsea U 21')).toBe('u21');
  });

  it('still matches harmless naming differences and swapped home/away', () => {
    expect(sameFixture({ homeTeam: 'Chelsea FC', awayTeam: 'AFC Bournemouth' }, { homeTeam: 'Chelsea', awayTeam: 'Bournemouth' })).toBe(true);
    expect(sameFixture({ homeTeam: 'Bournemouth', awayTeam: 'Chelsea' }, { homeTeam: 'Chelsea', awayTeam: 'Bournemouth' })).toBe(true);
  });

  it('different fixtures at the same time stay separate', () => {
    const a = base({ id: 'l365-1', homeTeam: 'Ipswich Town', awayTeam: 'Fulham FC' });
    const b = base({ id: 'l365-2', homeTeam: 'Sunderland AFC', awayTeam: 'Brighton Hove Albion' });
    expect(dedupeMatches([a, b])).toHaveLength(2);
  });

  it('the same pairing far apart in time (3h+) is a different fixture', () => {
    const a = base({ id: 'l365-1', homeTeam: 'Chelsea', awayTeam: 'Bournemouth' });
    const b = base({ id: 'l365-2', homeTeam: 'Chelsea', awayTeam: 'Bournemouth', startTime: '2026-10-11T14:00:00.000Z' });
    expect(dedupeMatches([a, b])).toHaveLength(2);
  });
});
