import { describe, it, expect } from 'vitest';
import { dedupeMatches, sameTeam, __sameTeamRaw, normTeam } from '../server/fixtureDedupe.js';

// The optimised dedupe (remembered name comparisons, old groups skipped) must give EXACTLY the groups of the plain algorithm.
const CLUBS = [
  ['Real Sociedad San Sebastian', 'Real Sociedad'], ['Rayo Vallecano', 'Rayo Vallecano'], ['Manchester City', 'Man City'],
  ['Manchester United', 'Man Utd'], ['Sheffield Utd', 'Sheffield Wed'], ['Sporting CP', 'Sporting'], ['Sporting CP B', 'Sporting Cp B'],
  ['FC Alverca SAD', 'Alverca'], ['Casa Pia Lisbon', 'Casa Pia'], ['Chelsea', 'Chelsea FC'], ['Chelsea W', 'Chelsea Women'],
  ['AGF Aarhus', 'Aarhus GF'], ['HB Koge', 'HB Køge'], ['1. FC Koeln', 'FC Köln'], ['Bournemouth', 'AFC Bournemouth'],
  ['Inter Milan', 'AC Milan'], ['Real Madrid', 'Real Betis'], ['Getafe', 'Getafe CF'], ['Tottenham', 'Tottenham Hotspur'],
  ['Wolves', 'Wolverhampton Wanderers'], ['Nottm Forest', 'Nottingham Forest'], ['Praha', 'Prague'], ['Brest', 'Stade Brest 29'],
  ['Arsenal', 'Arsenal FC'], ['Everton', 'Everton FC'], ['Fulham', 'Fulham FC'], ['Leeds', 'Leeds United'], ['Roma', 'AS Roma'],
];
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

function refGroups(list) {
  const WINDOW = 3 * 3600 * 1000;
  const sf = (a, b) => (__sameTeamRaw(a.homeTeam, b.homeTeam) && __sameTeamRaw(a.awayTeam, b.awayTeam))
    || (__sameTeamRaw(a.homeTeam, b.awayTeam) && __sameTeamRaw(a.awayTeam, b.homeTeam));
  const sorted = [...list].sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime));
  const groups = [];
  for (const m of sorted) {
    const t = Date.parse(m.startTime);
    let placed = false;
    if (!Number.isNaN(t)) {
      for (const g of groups) { if (Math.abs(t - g.time) > WINDOW) continue; if (sf(g.rep, m)) { g.c.push(m.id); placed = true; break; } }
    }
    if (!placed) groups.push({ rep: m, c: [m.id], time: t });
  }
  return groups.map((g) => g.c.slice().sort().join('|')).sort();
}

function gen(n, spanHours) {
  const base = Date.parse('2026-11-08T10:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const a = CLUBS[rnd(CLUBS.length)], b = CLUBS[rnd(CLUBS.length)];
    return {
      id: 'm' + i, status: 'UPCOMING', markets: [],
      homeTeam: a[rnd(2)], awayTeam: b[rnd(2)],
      startTime: new Date(base + rnd(spanHours * 4) * 15 * 60 * 1000).toISOString(),
    };
  });
}

describe('dedupeMatches: optimised == plain algorithm', () => {
  it('gives the same groups on random data (several sizes and time spreads)', () => {
    for (const [n, span] of [[60, 6], [300, 48], [800, 200], [500, 3]]) {
      const list = gen(n, span);
      const merged = [];
      const out = dedupeMatches(list, (ids) => merged.push(ids.slice().sort().join('|')));
      const singles = out.map((m) => m.id).filter((id) => !merged.some((g) => g.split('|').includes(id)));
      const mine = [...merged, ...singles].sort();
      expect(mine).toEqual(refGroups(list));
    }
  });
  it('keeps the plain scan when a kick-off time is not a date', () => {
    const list = gen(120, 24);
    list[5].startTime = 'not a date';
    const merged = [];
    const out = dedupeMatches(list, (ids) => merged.push(ids.slice().sort().join('|')));
    const singles = out.map((m) => m.id).filter((id) => !merged.some((g) => g.split('|').includes(id)));
    expect([...merged, ...singles].sort()).toEqual(refGroups(list));
  });
});

describe('remembered name functions answer like the originals', () => {
  it('sameTeam equals the unremembered version for every pair, twice', () => {
    const names = CLUBS.flat();
    for (let pass = 0; pass < 2; pass++) for (const a of names) for (const b of names) expect(sameTeam(a, b)).toBe(__sameTeamRaw(a, b));
  });
  it('handles empty / odd input without throwing', () => {
    expect(sameTeam(undefined, null)).toBe(__sameTeamRaw(undefined, null));
    expect(normTeam(undefined)).toBe('');
  });
});

describe('speed', () => {
  it('3000 matches dedupe well under the time the profile showed', () => {
    const list = gen(3000, 400);
    const t0 = Date.now();
    dedupeMatches(list);
    dedupeMatches(list);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
