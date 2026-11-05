import { describe, it, expect } from 'vitest';
import { randomInt } from 'node:crypto';
import * as crash from '../server/crash.js';
import * as hilo from '../server/hilo.js';
import * as hw from '../server/holdwin.js';
import { CASINO_GAME_KEYS, gameKeyForPath } from '../server/casinoAccess.js';

const rnd = (n) => randomInt(n);

describe('crash', () => {
  it('crash points are within [1, 1000] with 2 decimals', () => {
    for (let i = 0; i < 5000; i += 1) {
      const c = crash.drawCrashPoint(rnd);
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(crash.CRASH_MAX);
      expect(Math.round(c * 100) / 100).toBe(c);
    }
  });
  it('RTP is ~96% whatever the cash-out target', () => {
    for (const target of [1.5, 3, 10]) {
      const r = crash.simulateRtp(300000, rnd, target);
      expect(r).toBeGreaterThan(0.93);
      expect(r).toBeLessThan(0.99);
    }
  });
  it('deterministic extremes', () => {
    expect(crash.drawCrashPoint(() => 0)).toBe(1); // u=0 -> 0.96 -> floored to 1.00 (instant crash)
    expect(crash.drawCrashPoint(() => 999_999_999)).toBe(crash.CRASH_MAX);
  });
  it('multiplier curve and its inverse agree', () => {
    expect(crash.multiplierAt(0)).toBe(1);
    expect(crash.multiplierAt(crash.timeToMultiplier(2) + 0.01)).toBeGreaterThanOrEqual(2);
  });
  it('cash-out after the crash point loses, before it wins at the current multiplier', () => {
    expect(crash.resolveCashout({ crashPoint: 1.5, elapsedSec: 10 }).crashed).toBe(true);
    const ok = crash.resolveCashout({ crashPoint: 5, elapsedSec: crash.timeToMultiplier(2) });
    expect(ok.crashed).toBe(false);
    expect(ok.multiplier).toBeGreaterThanOrEqual(1.99);
  });
  it('auto cash-out pays exactly the target, never early and never past a crash', () => {
    expect(crash.resolveCashout({ crashPoint: 5, elapsedSec: crash.timeToMultiplier(2) + 0.1, autoTarget: 2 }).multiplier).toBe(2);
    expect(crash.resolveCashout({ crashPoint: 5, elapsedSec: 0.5, autoTarget: 2 }).early).toBe(true);
    expect(crash.resolveCashout({ crashPoint: 1.2, elapsedSec: 30, autoTarget: 2 }).crashed).toBe(true);
  });
});

describe('hi-lo', () => {
  it('a card with no higher/lower option cannot be guessed that way', () => {
    expect(hilo.winCount(13, 'higher')).toBe(0);
    expect(hilo.winCount(1, 'lower')).toBe(0);
    expect(hilo.playStep({ rank: 13, guess: 'higher', total: 1 }, rnd).error).toBe('IMPOSSIBLE');
  });
  it('each step is a 97% fair bet', () => {
    for (let rank = 1; rank <= 13; rank += 1) for (const g of ['higher', 'lower']) {
      const k = hilo.winCount(rank, g);
      if (!k) continue;
      expect((k / 13) * hilo.stepMultiplier(rank, g)).toBeCloseTo(0.97, 10);
    }
  });
  it('ties lose', () => {
    expect(hilo.playStep({ rank: 7, guess: 'higher', total: 1 }, () => 6).won).toBe(false); // next rank = 7
  });
  it('simulated RTP of single guess is ~97%', () => {
    let paid = 0; const N = 200000;
    for (let i = 0; i < N; i += 1) { const s = hilo.playStep({ rank: 5, guess: 'higher', total: 1 }, rnd); if (s.won) paid += s.total; }
    expect(paid / N).toBeGreaterThan(0.94);
    expect(paid / N).toBeLessThan(1.0);
  });
  it('caps at the max multiplier', () => {
    const s = hilo.playStep({ rank: 1, guess: 'higher', total: 999 }, () => 12);
    expect(s.total).toBeLessThanOrEqual(hilo.HILO_MAX);
  });
});

describe('hold & win', () => {
  it('RTP is ~96% and the bonus triggers sometimes', () => {
    const { rtp, bonusRate } = hw.simulateRtp(500000, rnd);
    expect(rtp).toBeGreaterThan(0.88);
    expect(rtp).toBeLessThan(1.04);
    expect(bonusRate).toBeGreaterThan(0.02);
  });
  it('rounds are internally consistent', () => {
    for (let i = 0; i < 3000; i += 1) {
      const r = hw.playRound(rnd);
      if (!r.bonus) { expect(r.multiplier).toBe(0); continue; }
      expect(r.start.length).toBeGreaterThanOrEqual(hw.MIN_TRIGGER);
      const cells = new Set(r.start.map((c) => c.cell));
      for (const rs of r.respins) for (const c of rs.landed) { expect(cells.has(c.cell)).toBe(false); cells.add(c.cell); }
      expect(r.full).toBe(cells.size === hw.CELLS);
      expect(r.multiplier).toBeLessThanOrEqual(hw.MAX_WIN_MULTIPLIER);
    }
  });
});

describe('game keys', () => {
  it('new games can be switched off by the super admin', () => {
    for (const k of ['crash', 'hilo', 'holdwin']) { expect(CASINO_GAME_KEYS).toContain(k); expect(gameKeyForPath(`/${k}/start`)).toBe(k); }
  });
});

import * as chainE from '../server/chain.js';
import * as horses from '../server/horses.js';
import * as cups from '../server/cups.js';

describe('chain games (penalty / tower)', () => {
  it('every step is 97% fair', () => {
    for (const cfg of [chainE.PENALTY_CFG, ...Object.values(chainE.TOWER_LEVELS)]) {
      expect(((cfg.doors - cfg.traps) / cfg.doors) * chainE.stepMultiplier(cfg)).toBeCloseTo(0.97, 10);
    }
  });
  it('traps are distinct and in range', () => {
    for (let i = 0; i < 2000; i += 1) {
      const t = chainE.drawTraps({ doors: 3, traps: 2, maxSteps: 8 }, rnd);
      expect(new Set(t).size).toBe(2);
      t.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(3); });
    }
  });
  it('rejects invalid choices and a trapped pick pays nothing', () => {
    expect(chainE.playStep({ cfg: chainE.PENALTY_CFG, total: 1, steps: 0, choice: 7 }, rnd).error).toBeTruthy();
    const lost = chainE.playStep({ cfg: chainE.PENALTY_CFG, total: 1.4, steps: 1, choice: 0 }, () => 0); // trap at index 0
    expect(lost.safe).toBe(false);
  });
  it('simulated single-step RTP ~97%', () => {
    let paid = 0; const N = 200000;
    for (let i = 0; i < N; i += 1) { const r = chainE.playStep({ cfg: chainE.TOWER_LEVELS.expert, total: 1, steps: 0, choice: 1 }, rnd); if (r.safe) paid += r.total; }
    expect(paid / N).toBeGreaterThan(0.94);
    expect(paid / N).toBeLessThan(1.0);
  });
  it('finishes at the max number of steps', () => {
    const r = chainE.playStep({ cfg: chainE.PENALTY_CFG, total: 20, steps: 9, choice: 1 }, () => 0);
    expect(r.safe && r.finished).toBe(true);
  });
});

describe('horse race', () => {
  it('probabilities add up to 1 and odds carry a 5% edge', () => {
    expect(horses.HORSES.reduce((a, h) => a + h.p, 0)).toBeCloseTo(1, 10);
    horses.HORSES.forEach((h) => expect(h.p * h.odds).toBeLessThanOrEqual(0.95 + 1e-9));
  });
  it('each horse wins about as often as its probability, and orders are permutations', () => {
    const wins = Array(6).fill(0); const N = 60000;
    for (let i = 0; i < N; i += 1) { const o = horses.drawOrder(rnd); expect([...o].sort().join()).toBe('0,1,2,3,4,5'); wins[o[0]] += 1; }
    horses.HORSES.forEach((h) => expect(Math.abs(wins[h.id] / N - h.p)).toBeLessThan(0.015));
  });
  it('pays only the winner', () => {
    expect(horses.horsePayout(100, 2, [2, 0, 1, 3, 4, 5])).toBe(horses.HORSES[2].odds * 100);
    expect(horses.horsePayout(100, 1, [2, 0, 1, 3, 4, 5])).toBe(0);
  });
});

describe('three cups', () => {
  it('final cup is uniform and consistent with the swaps', () => {
    const c = [0, 0, 0]; const N = 60000;
    for (let i = 0; i < N; i += 1) {
      const s = cups.drawShuffle(rnd);
      let ball = s.start; for (const [a, b] of s.swaps) { if (ball === a) ball = b; else if (ball === b) ball = a; }
      expect(ball).toBe(s.final); c[s.final] += 1;
    }
    c.forEach((x) => expect(Math.abs(x / N - 1 / 3)).toBeLessThan(0.015));
  });
  it('payout keeps a house edge', () => { expect(cups.CUPS_PAYOUT / 3).toBeLessThan(1); expect(cups.CUPS_PAYOUT / 3).toBeGreaterThan(0.9); });
});

import { maskName } from '../server/routes/casino.js';
describe('live feed privacy', () => {
  it('masks usernames', () => {
    expect(maskName('erikoleci')).toBe('er***i');
    expect(maskName('ab')).toBe('a***');
    expect(maskName('')).toBe('?***');
  });
});

import { simulatedFeed } from '../server/liveSim.js';
describe('live preview simulation', () => {
  it('is deterministic per moment, recent, and flagged as simulated', () => {
    const now = 1_800_000_000_000;
    const a = simulatedFeed(now); const b = simulatedFeed(now);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
    a.forEach((f) => { expect(f.simulated).toBe(true); expect(f.at).toBeLessThanOrEqual(now); });
  });
});

import * as lr from '../server/liveRoulette.js';
describe('live roulette', () => {
  it('phases follow the clock', () => {
    const base = 1_800_000_000_000 - (1_800_000_000_000 % lr.CYCLE_MS);
    expect(lr.phaseAt(base + 1000).phase).toBe('betting');
    expect(lr.phaseAt(base + lr.BET_MS + 1).phase).toBe('spin');
    expect(lr.roundNo(base)).toBe(lr.roundNo(base + lr.CYCLE_MS - 1));
    expect(lr.roundNo(base + lr.CYCLE_MS)).toBe(lr.roundNo(base) + 1);
  });
  it('validates spots', () => {
    ['0', '17', '36', 'RED', 'D2', 'LOW'].forEach((s) => expect(lr.validSpot(s)).toBe(true));
    ['37', '-1', '05', 'GREEN', '', '1.5'].forEach((s) => expect(lr.validSpot(s)).toBe(false));
  });
  it('every spot has the same 2.7% edge (zero loses outside bets)', () => {
    const rtp = (spot) => { let t = 0; for (let n = 0; n <= 36; n += 1) t += lr.spotMultiplier(spot, n); return t / 37; };
    ['RED', 'BLACK', 'EVEN', 'ODD', 'LOW', 'HIGH', 'D1', 'D2', 'D3', '7'].forEach((s) => expect(rtp(s)).toBeCloseTo(36 / 37, 10));
  });
  it('settles several bets at once', () => {
    expect(lr.settleBets({ RED: 10, '7': 5, EVEN: 10 }, 7)).toBe(20 + 180);
    expect(lr.settleBets({ RED: 10, ODD: 10 }, 0)).toBe(0);
  });
});

import { simulatedPlaying } from '../server/liveSim.js';
describe('slot player counts', () => {
  it('are stable, positive and drift over time', () => {
    const ids = ['hot-fruits', 'lucky-dragon'];
    const a = simulatedPlaying(ids, 1_800_000_000_000);
    expect(simulatedPlaying(ids, 1_800_000_000_000)).toEqual(a);
    ids.forEach((i) => expect(a[i]).toBeGreaterThan(1));
    expect(simulatedPlaying(ids, 1_800_000_000_000 + 300000)).not.toEqual(a);
  });
});

import * as lh from '../server/liveHorses.js';
describe('live horse race', () => {
  it('phases follow the clock and only the winner pays', () => {
    const base = 1_800_000_000_000 - (1_800_000_000_000 % lh.CYCLE_MS);
    expect(lh.phaseAt(base + 1).phase).toBe('betting');
    expect(lh.phaseAt(base + lh.BET_MS + 1).phase).toBe('race');
    expect(lh.settle({ '2': 100, '1': 50 }, [2, 0, 1, 3, 4, 5])).toBeGreaterThan(0);
    expect(lh.settle({ '1': 50 }, [2, 0, 1, 3, 4, 5])).toBe(0);
    expect(lh.validHorse('5')).toBe(true); expect(lh.validHorse('6')).toBe(false);
  });
});

import * as dogs from '../server/dogs.js';
import * as ld from '../server/liveDogs.js';
describe('dog race', () => {
  it('probabilities sum to 1, odds keep a 5% edge, winners follow probabilities', () => {
    expect(dogs.DOGS.reduce((a, d) => a + d.p, 0)).toBeCloseTo(1, 10);
    dogs.DOGS.forEach((d) => expect(d.p * d.odds).toBeLessThanOrEqual(0.95 + 1e-9));
    const wins = Array(6).fill(0); const N = 60000;
    for (let i = 0; i < N; i += 1) { const o = dogs.drawOrder(rnd); expect([...o].sort().join()).toBe('0,1,2,3,4,5'); wins[o[0]] += 1; }
    dogs.DOGS.forEach((d) => expect(Math.abs(wins[d.id] / N - d.p)).toBeLessThan(0.015));
  });
  it('live table phases and settlement', () => {
    const base = 1_800_000_000_000 - (1_800_000_000_000 % ld.CYCLE_MS);
    expect(ld.phaseAt(base + 1).phase).toBe('betting');
    expect(ld.phaseAt(base + ld.BET_MS + 1).phase).toBe('race');
    expect(ld.settle({ '0': 100 }, [0, 1, 2, 3, 4, 5])).toBe(dogs.DOGS[0].odds * 100);
    expect(ld.settle({ '1': 100 }, [0, 1, 2, 3, 4, 5])).toBe(0);
  });
});

import * as lc from '../server/liveCrash.js';
import * as lk from '../server/liveKeno.js';
describe('live crash', () => {
  const R = 50000; // some round number
  const start = lc.flightStart(R);
  it('betting then flight, crash reveals at the right time', () => {
    expect(lc.infoAt(R * lc.CYCLE_MS + 100).phase).toBe('betting');
    expect(lc.infoAt(start + 500, 5).phase).toBe('flight');
    expect(lc.infoAt(start + lc.timeTo(5) * 1000 + 50, 5).phase).toBe('crashed');
  });
  it('outcomes: loss after the crash, auto cash-out pays the target, still flying otherwise', () => {
    const cp = 5;
    expect(lc.outcome({ round: R, auto: null }, cp, start + 1000).done).toBe(false);
    expect(lc.outcome({ round: R, auto: null }, cp, start + lc.timeTo(cp) * 1000 + 100)).toEqual({ done: true, multiplier: 0 });
    expect(lc.outcome({ round: R, auto: 2 }, cp, start + lc.timeTo(2) * 1000 + 100)).toEqual({ done: true, multiplier: 2 });
    expect(lc.outcome({ round: R, auto: 8 }, cp, start + lc.timeTo(cp) * 1000 + 100)).toEqual({ done: true, multiplier: 0 });
    expect(lc.outcome({ round: R, auto: null }, 1000, (R + 1) * lc.CYCLE_MS + 5)).toEqual({ done: true, multiplier: 0 });
  });
  it('crash points are capped and the flight fits in the window', () => {
    for (let i = 0; i < 3000; i += 1) { const c = lc.draw(rnd); expect(c).toBeLessThanOrEqual(lc.LIVE_CAP); expect(lc.timeTo(c) * 1000 + lc.BET_MS).toBeLessThan(lc.CYCLE_MS); }
  });
});
describe('live keno', () => {
  it('phases and pick validation', () => {
    const base = 1_800_000_000_000 - (1_800_000_000_000 % lk.CYCLE_MS);
    expect(lk.phaseAt(base + 5).phase).toBe('betting'); expect(lk.phaseAt(base + lk.BET_MS + 5).phase).toBe('draw');
    expect(lk.validPicks([1, 2, 40])).toBe(true); expect(lk.validPicks([])).toBe(false); expect(lk.validPicks([1, 1])).toBe(false); expect(lk.validPicks([41])).toBe(false);
  });
  it('draws 10 distinct balls', () => { const d = lk.draw((n) => randomInt(0, n)); expect(new Set(d).size).toBe(10); });
});
