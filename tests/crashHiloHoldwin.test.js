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
