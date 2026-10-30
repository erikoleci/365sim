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
  const g = game('hot-fruits');
  it('pays 3, 4 and 5 of a kind from the left on a line', () => {
    const grid = filler('LEMON');
    grid[0] = ['BELL', 'CHERRY', 'BELL']; grid[1] = ['BELL', 'CHERRY', 'BELL']; grid[2] = ['BELL', 'CHERRY', 'BELL']; grid[3] = ['BELL', 'BELL', 'BELL']; grid[4] = ['BELL', 'BELL', 'BELL'];
    const wins = evaluateLines(g, grid);
    const middle = wins.find((w) => w.line === 0);
    expect(middle).toMatchObject({ symbol: 'CHERRY', count: 3, pay: g.paytable.CHERRY[3] });
  });
  it('a wild substitutes for symbols but not for the scatter', () => {
    const grid = filler('BELL'); // no win for a different symbol below
    grid[0] = ['LEMON', 'SEVEN', 'LEMON']; grid[1] = ['LEMON', WILD, 'LEMON']; grid[2] = ['LEMON', 'SEVEN', 'LEMON']; grid[3] = ['LEMON', 'CHERRY', 'LEMON']; grid[4] = ['LEMON', 'CHERRY', 'LEMON'];
    expect(evaluateLines(g, grid).find((w) => w.line === 0)).toMatchObject({ symbol: 'SEVEN', count: 3 });
    const sc = filler('BELL'); sc[0] = ['LEMON', SCATTER, 'LEMON']; sc[1] = ['LEMON', WILD, 'LEMON']; sc[2] = ['LEMON', SCATTER, 'LEMON'];
    expect(evaluateLines(g, sc).find((w) => w.line === 0)).toBeUndefined();
  });
  it('an expanding wild covers its whole reel', () => {
    const e = game('pharaoh-gold');
    const grid = filler('PALM'); grid[2] = ['JAR', WILD, 'JAR'];
    expect(expandWilds(e, grid)[2]).toEqual([WILD, WILD, WILD]);
    expect(expandWilds(g, grid)[2]).toEqual(['JAR', WILD, 'JAR']);
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
      const { rtp } = exactRtp(x);
      expect(Math.abs(rtp * 100 - x.rtp)).toBeLessThan(0.01);
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
