import { describe, it, expect } from 'vitest';
import { SLOT_GAMES, publicGame } from '../server/slots/games.js';
import { evaluateLines, expandWilds, playRound, exactRtp, WILD, SCATTER } from '../server/slots/engine.js';
import { canOpenCasino } from '../server/casinoAccess.js';

function seeded(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}
const game = (id) => SLOT_GAMES.find((g) => g.id === id);
const filler = (s) => [[s, s, s], [s, s, s], [s, s, s], [s, s, s], [s, s, s]];

describe('slot engine', () => {
  const g = game('golden-lady');
  it('pays 3, 4 and 5 of a kind from the left on a line', () => {
    const grid = filler('S2');
    grid[0] = ['S3', 'S1', 'S3']; grid[1] = ['S3', 'S1', 'S3']; grid[2] = ['S3', 'S1', 'S3']; grid[3] = ['S3', 'S3', 'S3']; grid[4] = ['S3', 'S3', 'S3'];
    const wins = evaluateLines(g, grid);
    const middle = wins.find((w) => w.line === 0);
    expect(middle).toMatchObject({ symbol: 'S1', count: 3, pay: g.paytable.S1[3] });
  });
  it('a wild substitutes for symbols but not for the scatter', () => {
    const grid = filler('S3'); // no win for a different symbol below
    grid[0] = ['S2', 'S7', 'S2']; grid[1] = ['S2', WILD, 'S2']; grid[2] = ['S2', 'S7', 'S2']; grid[3] = ['S2', 'S1', 'S2']; grid[4] = ['S2', 'S1', 'S2'];
    expect(evaluateLines(g, grid).find((w) => w.line === 0)).toMatchObject({ symbol: 'S7', count: 3 });
    const sc = filler('S3'); sc[0] = ['S2', SCATTER, 'S2']; sc[1] = ['S2', WILD, 'S2']; sc[2] = ['S2', SCATTER, 'S2'];
    expect(evaluateLines(g, sc).find((w) => w.line === 0)).toBeUndefined();
  });
  it('an expanding wild covers its whole reel', () => {
    const e = game('pharaoh-gold');
    const grid = filler('S4'); grid[2] = ['S5', WILD, 'S5'];
    expect(expandWilds(e, grid)[2]).toEqual([WILD, WILD, WILD]);
    expect(expandWilds(g, grid)[2]).toEqual(['S5', WILD, 'S5']);
  });
  it('a round is the base spin plus the free spins it triggered', () => {
    const rng = seeded(7);
    let seen = false;
    for (let i = 0; i < 20000 && !seen; i += 1) {
      const r = playRound(g, rng);
      const awarded = g.freeSpins[r.spins[0].scatters] ?? 0;
      expect(r.spins.length).toBe(1 + awarded);
      if (awarded > 0) { seen = true; expect(r.spins.slice(1).every((s) => s.free)).toBe(true); }
    }
    expect(seen).toBe(true);
  });
  it("never exposes the reel strips to the browser", () => {
    for (const x of SLOT_GAMES) expect(publicGame(x).strips).toBeUndefined();
  });
});

describe('slot RTP is real and ~95%', () => {
  for (const x of SLOT_GAMES) {
    it(`${x.id}: exact RTP matches the published figure`, () => {
      // 6- and 7-reel games have too many combinations to enumerate: their figure comes from a 3M-round seeded simulation
      // (scripts/tuneSlots.mjs), checked below by a fresh simulation.
      if (x.reels <= 5) { const { rtp } = exactRtp(x); expect(Math.abs(rtp * 100 - x.rtp)).toBeLessThan(0.01); }
      expect(x.rtp).toBeGreaterThan(94);
      expect(x.rtp).toBeLessThan(96);
    }, 60000);
    it(`${x.id}: simulation agrees with it`, () => {
      const rng = seeded(1234);
      let total = 0; const n = 250000;
      for (let i = 0; i < n; i += 1) total += playRound(x, rng).totalMultiplier;
      expect(Math.abs((total / n) * 100 - x.rtp)).toBeLessThan(6);
    }, 60000);
  }
});

describe('casino access switch', () => {
  it('off: nobody. super: only the super admin. all: everybody', () => {
    expect(canOpenCasino('off', 'SUPER_ADMIN')).toBe(false);
    expect(canOpenCasino('super', 'SUPER_ADMIN')).toBe(true);
    expect(canOpenCasino('super', 'USER')).toBe(false);
    expect(canOpenCasino('all', 'USER')).toBe(true);
  });
});

describe('slot layouts differ in shape, not only in pictures', () => {
  it('the catalogue mixes 3, 4, 5, 6 and 7 reels and different numbers of lines', () => {
    expect(new Set(SLOT_GAMES.map((x) => x.reels))).toEqual(new Set([3, 4, 5, 6, 7]));
    expect(new Set(SLOT_GAMES.map((x) => x.lines)).size).toBeGreaterThanOrEqual(6);
  });
  it('every game has one strip per reel, valid lines, and pays only for 3..reels of a kind', () => {
    for (const x of SLOT_GAMES) {
      expect(x.strips).toHaveLength(x.reels);
      expect(x.paylines).toHaveLength(x.lines);
      x.paylines.forEach((l) => { expect(l).toHaveLength(x.reels); l.forEach((row) => { expect(row >= 0 && row <= 2).toBe(true); }); });
      expect(new Set(x.paylines.map((l) => l.join(''))).size).toBe(x.lines); // no duplicate line
      expect(Object.keys(x.paytable.WILD).map(Number)).toEqual(Array.from({ length: x.reels - 2 }, (_, i) => i + 3));
    }
  });
  it('a round of every layout produces a grid of the right size', () => {
    const rng = seeded(99);
    for (const x of SLOT_GAMES) { const r = playRound(x, rng); expect(r.spins[0].grid).toHaveLength(x.reels); r.spins[0].grid.forEach((c) => expect(c).toHaveLength(3)); }
  });
});
