import { describe, it, expect } from 'vitest';
import * as liveDogs from '../server/liveDogs.js';
import * as liveHorses from '../server/liveHorses.js';
import { dogsFor, dogPayout, drawOrder as dogOrder, DOGS } from '../server/dogs.js';
import { horsesFor, horsePayout, drawOrder as horseOrder, HORSES } from '../server/horses.js';
import { mulberry32, makeRaceToken, readRaceToken } from '../server/raceOdds.js';

const rngOf = (seed) => { const r = mulberry32(seed); return (n) => Math.floor(r() * n); };

// The odds a player sees, the order that is drawn and the money that is paid must all come from the SAME runners.
describe('live races: shown odds = drawn chances = paid odds (every round)', () => {
  const first = liveDogs.VARY_FROM_ROUND;
  for (const [name, engine, runnersOf, winnerOdds] of [
    ['dogs', liveDogs, (r) => liveDogs.runnersFor(r), (runners, w, stake) => stake * runners[w].odds],
    ['horses', liveHorses, (r) => liveHorses.horsesForRound(r), (runners, w, stake) => stake * runners[w].odds],
  ]) {
    it(`${name}: odds are 0.95 / chance, chances sum to 1, settle pays exactly the shown odds`, () => {
      const base0 = name === 'dogs' ? liveDogs.VARY_FROM_ROUND : liveHorses.VARY_FROM_ROUND;
      const seen = new Set();
      for (let round = base0; round < base0 + 300; round += 1) {
        const runners = runnersOf(round);
        expect(Math.abs(runners.reduce((a, r) => a + r.p, 0) - 1)).toBeLessThan(1e-9);
        for (const r of runners) {
          expect(r.odds).toBeCloseTo(Math.floor((0.95 / r.p) * 100) / 100, 2);
          expect(r.odds * r.p).toBeLessThanOrEqual(0.95 + 1e-9);
        }
        seen.add(runners.map((r) => r.odds).join(','));
        const order = engine.draw(rngOf(round), round);
        expect(new Set(order).size).toBe(6);
        const w = order[0];
        expect(engine.settle({ [w]: 10 }, order, round)).toBeCloseTo(Math.round(winnerOdds(runners, w, 10) * 100) / 100, 2);
        const loser = order[1];
        expect(engine.settle({ [loser]: 10 }, order, round)).toBe(0);
      }
      expect(seen.size).toBeGreaterThan(250); // the odds really change every round
    });
    it(`${name}: rounds before the change keep the old fixed odds`, () => {
      const base0 = name === 'dogs' ? liveDogs.VARY_FROM_ROUND : liveHorses.VARY_FROM_ROUND;
      const old = runnersOf(base0 - 5);
      expect(old.map((r) => r.odds)).toEqual((name === 'dogs' ? DOGS : HORSES).map((r) => r.odds));
    });
  }
  it('dogs: the drawn winner frequency follows the shown chances (round 1, 60000 draws)', () => {
    const round = first + 11; const runners = liveDogs.runnersFor(round); const rng = rngOf(5); const wins = new Array(6).fill(0);
    for (let i = 0; i < 60000; i += 1) wins[liveDogs.draw(rng, round)[0]] += 1;
    runners.forEach((r, i) => expect(Math.abs(wins[i] / 60000 - r.p)).toBeLessThan(0.012));
  });
  it('dogs: forecast (1st-2nd) odds follow the same round runners and pay on the exact pair', () => {
    const round = first + 3; const runners = liveDogs.runnersFor(round);
    const order = liveDogs.draw(rngOf(9), round);
    const pay = liveDogs.settle({ [`F${order[0]}-${order[1]}`]: 10 }, order, round);
    expect(pay).toBeCloseTo(Math.round(10 * liveDogs.forecastOdds(order[0], order[1], runners) * 100) / 100, 2);
    expect(liveDogs.settle({ [`F${order[1]}-${order[0]}`]: 10 }, order, round)).toBe(0);
  });
});

describe('single-player races: the signed token fixes the odds the player saw', () => {
  const secret = 'test-secret';
  for (const [name, runnersOf, payoutOf, orderOf] of [['dogs', dogsFor, dogPayout, dogOrder], ['horses', horsesFor, horsePayout, horseOrder]]) {
    it(`${name}: token -> same runners -> payout uses the odds shown; changing the rtp changes the odds`, () => {
      for (const rtp of [0.3, 0.6, 0.95]) {
        const { seed, token } = makeRaceToken(secret, Date.now(), 12345, rtp);
        const t = readRaceToken(token, secret);
        expect(t).toEqual({ seed, rtp });
        const shown = runnersOf(seed, rtp); const used = runnersOf(t.seed, t.rtp);
        expect(used.map((r) => r.odds)).toEqual(shown.map((r) => r.odds));
        shown.forEach((r) => expect(r.odds * r.p).toBeLessThanOrEqual(rtp + 1e-9));
        const order = orderOf(rngOf(4), used);
        expect(payoutOf(10, order[0], order, used)).toBeCloseTo(Math.round(10 * shown[order[0]].odds * 100) / 100, 2);
        expect(payoutOf(10, order[1], order, used)).toBe(0);
      }
    });
  }
  it('a tampered or expired token is refused', () => {
    const { token } = makeRaceToken(secret, Date.now(), 1, 0.6);
    expect(readRaceToken(`${token}x`, secret)).toBeNull();
    expect(readRaceToken(token, 'other-secret')).toBeNull();
    expect(readRaceToken(token, secret, Date.now() + 16 * 60 * 1000)).toBeNull();
  });
  it('single-player long-run return equals the configured rtp (dogs, 300k races)', () => {
    const rng = rngOf(21); let staked = 0; let paid = 0;
    for (let i = 0; i < 300000; i += 1) {
      const dogs = dogsFor(1 + (i % 5000), 0.6); const order = dogOrder(rng, dogs); const pick = i % 6;
      staked += 1; paid += dogPayout(1, pick, order, dogs);
    }
    expect(Math.abs(paid / staked - 0.6)).toBeLessThan(0.02);
  });
});
