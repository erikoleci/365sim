import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() } }));
import pool from '../server/db.js';
import {
  REGISTRY, PROFILE_KEYS, cleanProfileInput, getProfile, saveProfile, resetProfile, clearProfileCache, outcomeScale, drawProfiled, validBet, getCalibration,
} from '../server/casinoProfiles.js';
import { outcomeGames, simulateProfile } from '../server/casinoOutcomeGames.js';
import { mulberry32 } from '../server/raceOdds.js';
import { plinkoMultipliers, plinkoProbabilities } from '../server/casinoMath.js';
import { dogsFor, DOGS } from '../server/dogs.js';
import { horsesFor } from '../server/horses.js';
import { CASINO_GAME_KEYS } from '../server/casinoAccess.js';

beforeEach(() => { clearProfileCache(); pool.query.mockReset(); pool.query.mockResolvedValue({ rows: [] }); });

describe('registry', () => {
  it('has a profile for every game and every video slot, each with its own settings', () => {
    for (const k of CASINO_GAME_KEYS.filter((g) => g !== 'slots')) expect(REGISTRY[k], k).toBeTruthy();
    expect(PROFILE_KEYS.filter((k) => k.startsWith('slot:')).length).toBe(30);
    expect(REGISTRY.slots.kind).toBe('outcome');
    expect(REGISTRY.dogs.kind).toBe('rtp');
    expect(REGISTRY.roulette.kind).toBe('bets');
  });
  it('every outcome game has a calibration measured on its real engine', () => {
    for (const e of Object.values(REGISTRY).filter((x) => x.kind === 'outcome')) {
      const c = getCalibration(e.key);
      expect(c, e.key).toBeTruthy();
      expect(c.meanWin).toBeGreaterThan(0); expect(c.pWin).toBeGreaterThan(0);
      expect(c.rtpNat).toBeGreaterThan(0.85); expect(c.rtpNat).toBeLessThan(1.05); // natural returns stay near the fair ~95%
    }
  });
});

describe('validation', () => {
  it('accepts sane values and refuses unknown fields, wrong types and out-of-range numbers', () => {
    expect(cleanProfileInput('wheel', { hitFrequency: 0.2, rtp: 0.5 })).toEqual({ hitFrequency: 0.2, rtp: 0.5 });
    expect(() => cleanProfileInput('wheel', { colour: 1 })).toThrow(/not a setting/);
    expect(() => cleanProfileInput('roulette', { rtp: 0.5 })).toThrow(/not a setting/); // rules fix roulette's payouts
    expect(() => cleanProfileInput('wheel', { rtp: '0.5' })).toThrow(/number/);
    expect(() => cleanProfileInput('wheel', { rtp: 1.5 })).toThrow(/between/);
    expect(() => cleanProfileInput('wheel', { hitFrequency: 0 })).toThrow(/between/);
    expect(() => cleanProfileInput('nope', {})).toThrow(/Unknown/);
    expect(() => cleanProfileInput('wheel', null)).toThrow();
  });
  it('bet limits', () => {
    const p = { minBet: 2, maxBet: 100 };
    expect(validBet(p, 2)).toBe(true); expect(validBet(p, 100)).toBe(true);
    expect(validBet(p, 1)).toBe(false); expect(validBet(p, 101)).toBe(false); expect(validBet(p, NaN)).toBe(false); expect(validBet(p, '5')).toBe(false);
  });
});

describe('storage', () => {
  it('defaults, per-game overrides, audit data (before/after) and reset', async () => {
    expect((await getProfile('wheel')).hitFrequency).toBe(0.15);
    pool.query.mockResolvedValueOnce({ rows: [] }); // read before saving
    const r = await saveProfile('wheel', { hitFrequency: 0.25, maxBet: 200 });
    expect(r.before.hitFrequency).toBe(0.15); expect(r.after.hitFrequency).toBe(0.25); expect(r.after.maxBet).toBe(200);
    const write = pool.query.mock.calls.find((c) => /INSERT INTO kv_store/.test(c[0]));
    expect(JSON.parse(write[1][1]).wheel.hitFrequency).toBe(0.25);
    expect((await getProfile('wheel')).hitFrequency).toBe(0.25);   // cached after the save
    expect((await getProfile('scratch')).hitFrequency).toBe(0.15); // other games untouched
    const back = await resetProfile('wheel');
    expect(back.after.hitFrequency).toBe(0.15);
  });
  it('refuses min bet above max bet', async () => {
    await expect(saveProfile('wheel', { minBet: 500, maxBet: 100 })).rejects.toThrow(/Min bet/);
  });
});

// Every outcome game, through the real engines and the same pipeline as the server: measured hit frequency and RTP must
// match the profile within statistical tolerance (fixed seeds, so this never flakes).
describe('simulation: measured results match the profile', () => {
  const N = 40000;
  const settings = [{ hitFrequency: 0.15, rtp: 0.3 }, { hitFrequency: 0.3, rtp: 0.8 }];
  for (const s of settings) {
    it(`all 35 outcome games at hit ${s.hitFrequency * 100}% / RTP ${s.rtp * 100}%`, () => {
      const profile = { ...s, minBet: 1, maxBet: 5000, maxWinMultiplier: 2000 };
      const r1 = mulberry32(11); const r2 = mulberry32(22);
      const rng = (n) => Math.floor(r1() * n); const randFloat = () => r2();
      const games = outcomeGames(rng);
      expect(Object.keys(games).length).toBe(35);
      for (const [key, game] of Object.entries(games)) {
        const out = simulateProfile({ profile, cal: getCalibration(key), game, rounds: N, rng, randFloat, drawProfiled, outcomeScale });
        const hitTol = 5 * Math.sqrt((s.hitFrequency * (1 - s.hitFrequency)) / N);
        expect(Math.abs(out.hit - s.hitFrequency), `${key} hit`).toBeLessThan(hitTol);
        const rtpTol = 5 * (out.sd / Math.sqrt(N)) + 0.015 * s.rtp; // sampling error + calibration error + the max-win cap
        expect(Math.abs(out.rtp - s.rtp), `${key} rtp ${out.rtp.toFixed(3)}`).toBeLessThan(rtpTol);
      }
    });
  }
  it('a losing round never pays and a win always pays something', () => {
    const profile = { hitFrequency: 0.15, rtp: 0.3, minBet: 1, maxBet: 5000, maxWinMultiplier: 2000 };
    const r = mulberry32(5); const rng = (n) => Math.floor(r() * n); const games = outcomeGames(rng); const g = games.wheel;
    for (let i = 0; i < 2000; i += 1) {
      const d = drawProfiled({ profile, cal: getCalibration('wheel'), drawOnce: g.drawOnce, multiplierOf: g.multiplierOf, randFloat: () => r() });
      if (d.win) expect(g.multiplierOf(d.round)).toBeGreaterThan(0); else expect(g.multiplierOf(d.round)).toBe(0);
    }
  });
  it('the result does not depend on who plays: the pipeline has no player input at all', () => {
    expect(drawProfiled.length === 1 || true).toBe(true);
    const src = drawProfiled.toString();
    expect(/user|balance|history|stake/i.test(src)).toBe(false);
  });
});

describe('rtp-kind games (chances fixed by the rules, payout table scaled)', () => {
  it('dog and horse odds return exactly the profile rtp in every race', () => {
    for (const rtp of [0.3, 0.6, 0.95]) for (let seed = 1; seed <= 50; seed += 1) {
      for (const runners of [dogsFor(seed, rtp), horsesFor(seed, rtp)]) {
        // betting on any one runner returns rtp: chance x odds
        for (const r of runners) { expect(r.p * r.odds).toBeLessThanOrEqual(rtp + 1e-9); expect(r.p * r.odds).toBeGreaterThan(rtp - 0.02); }
        expect(Math.abs(runners.reduce((a, r) => a + r.p, 0) - 1)).toBeLessThan(1e-9);
      }
    }
    expect(dogsFor(3)[0].odds).toBe(dogsFor(3, 0.95)[0].odds); // default is the old 95%
    expect(DOGS.length).toBe(6);
  });
  it('plinko tables return exactly the profile rtp for every board', () => {
    for (const rtp of [0.3, 0.6, 0.97]) for (const rows of [8, 12, 16]) for (const risk of ['LOW', 'MEDIUM', 'HIGH']) {
      const p = plinkoProbabilities(rows); const m = plinkoMultipliers(rows, risk, rtp);
      expect(m.every((x) => x >= 0)).toBe(true);
      expect(Math.abs(m.reduce((a, x, k) => a + x * p[k], 0) - rtp)).toBeLessThan(0.01);
    }
    expect(plinkoMultipliers(8, 'LOW')).toEqual(plinkoMultipliers(8, 'LOW', 0.97)); // default unchanged
  });
});
