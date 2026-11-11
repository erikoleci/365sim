import { describe, it, expect } from 'vitest';
import { varyRunners, makeRaceToken, readRaceToken, drawOrderFor } from '../server/raceOdds.js';
import { DOGS, DOG_RTP, dogsFor } from '../server/dogs.js';
import { HORSES, HORSE_RTP, horsesFor } from '../server/horses.js';
import * as liveDogs from '../server/liveDogs.js';
import * as liveHorses from '../server/liveHorses.js';

describe('odds that change every race', () => {
  it('chances always add up to 1 and the return stays at the stated RTP', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      for (const [base, rtp] of [[DOGS, DOG_RTP], [HORSES, HORSE_RTP]]) {
        const r = varyRunners(base, seed, rtp);
        expect(Math.abs(r.reduce((a, x) => a + x.p, 0) - 1)).toBeLessThan(1e-9);
        for (const x of r) { expect(x.odds * x.p).toBeLessThanOrEqual(rtp + 1e-9); expect(x.odds * x.p).toBeGreaterThan(rtp - 0.03); expect(x.odds).toBeGreaterThan(1.2); }
      }
    }
  });
  it('is deterministic per seed and different between seeds', () => {
    expect(dogsFor(5)).toEqual(dogsFor(5));
    const seen = new Set(); for (let s = 1; s <= 50; s += 1) seen.add(dogsFor(s)[0].odds);
    expect(seen.size).toBeGreaterThan(30);
    expect(horsesFor(9)[0].odds).not.toBe(horsesFor(10)[0].odds);
  });
  it('the draw follows the race chances (favourite wins about as often as its chance)', () => {
    const runners = dogsFor(42); let wins = 0; const n = 20000;
    let seed = 7; const rnd = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
    for (let i = 0; i < n; i += 1) if (drawOrderFor(runners, rnd)[0] === 0) wins += 1;
    expect(Math.abs(wins / n - runners[0].p)).toBeLessThan(0.02);
  });
  it('race tokens: genuine and fresh only', () => {
    const { seed, token } = makeRaceToken('secret', 1000, undefined, 0.6);
    expect(readRaceToken(token, 'secret', 2000)).toEqual({ seed, rtp: 0.6 });
    expect(readRaceToken(token, 'other', 2000)).toBeNull();
    expect(readRaceToken(token, 'secret', 1000 + 16 * 60 * 1000)).toBeNull();
    expect(readRaceToken('1.2.3', 'secret')).toBeNull();
    expect(readRaceToken(undefined, 'secret')).toBeNull();
  });
  it('live races: old rounds keep the old odds, new rounds vary and settle at that round\'s odds', () => {
    expect(liveDogs.runnersFor(liveDogs.VARY_FROM_ROUND - 1)).toBe(DOGS);
    expect(liveHorses.horsesForRound(liveHorses.VARY_FROM_ROUND - 1)).toBe(HORSES);
    const r = liveDogs.VARY_FROM_ROUND + 3;
    const runners = liveDogs.runnersFor(r);
    expect(runners[0].odds).not.toBe(DOGS[0].odds);
    expect(liveDogs.settle({ 0: 10 }, [0, 1, 2, 3, 4, 5], r)).toBe(Math.round(10 * runners[0].odds * 100) / 100);
    const hr = liveHorses.VARY_FROM_ROUND + 3; const hs = liveHorses.horsesForRound(hr);
    expect(liveHorses.settle({ 1: 10 }, [1, 0, 2, 3, 4, 5], hr)).toBe(Math.round(10 * hs[1].odds * 100) / 100);
    const fc = liveDogs.forecastFor(runners); let tot = 0;
    for (let a = 0; a < 6; a += 1) for (let b = 0; b < 6; b += 1) if (a !== b) tot += (runners[a].p * runners[b].p) / (1 - runners[a].p) * fc[a][b];
    expect(tot / 30).toBeLessThanOrEqual(DOG_RTP + 1e-9);
  });
});
