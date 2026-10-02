import { describe, it, expect } from 'vitest';
import { reconcileEvents } from '../server/eventReconcile.js';

const base = { homeTeam: 'Zaglebie Lubin II', awayTeam: 'Gornik Polkowice' };
const g = (minute, team) => ({ minute, type: 'GOAL', team });

describe('reconcileEvents', () => {
  it('drops goal rows beyond the score (newest extras first)', () => {
    const evs = [g(42, 'Gornik Polkowice'), g(63, 'Gornik Polkowice'), g(67, 'Gornik Polkowice')];
    const out = reconcileEvents(evs, { ...base, homeScore: 0, awayScore: 1 });
    expect(out.map((e) => e.minute)).toEqual([42]);
  });
  it('trims cards to the per-side total', () => {
    const c = (minute, team) => ({ minute, type: 'YELLOW_CARD', team });
    const out = reconcileEvents([c(68, 'home'), c(68, 'away'), c(71, 'home')], { ...base, cardsHome: 1, cardsAway: 1 });
    expect(out.map((e) => e.minute + e.team)).toEqual(['68home', '68away']);
  });
  it('leaves everything alone when totals are unknown; keeps other event types', () => {
    const evs = [g(10, 'Gornik Polkowice'), g(20, 'Gornik Polkowice'), { minute: 30, type: 'CORNER', team: 'home' }];
    expect(reconcileEvents(evs, base)).toHaveLength(3);
    expect(reconcileEvents(evs, { ...base, homeScore: 0, awayScore: 2 })).toHaveLength(3);
  });
});

describe('reconcileEvents duplicates', () => {
  it('shows an identical goal / corner / card row once', () => {
    const evs = [
      { minute: 10, type: 'CORNER', team: 'home', detail: '1' },
      { minute: 10, type: 'CORNER', team: 'home', detail: '1' },
      { minute: 12, type: 'CORNER', team: 'home', detail: '2' },
      { minute: 15, type: 'YELLOW_CARD', team: 'away', detail: '1' },
      { minute: 15, type: 'YELLOW_CARD', team: 'away', detail: '1' },
    ];
    expect(reconcileEvents(evs, {}).map((e) => e.type + e.detail)).toEqual(['CORNER1', 'CORNER2', 'YELLOW_CARD1']);
  });
});
