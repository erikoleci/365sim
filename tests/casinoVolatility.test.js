import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
import { betTotalOf, validBet, getCalibration, drawProfiled, outcomeScale, previewOutcome, saveProfile, cleanProfileInput, rtpFactor, REGISTRY, NATURAL_RTP } from '../server/casinoProfiles.js';
import { outcomeGames, simulateProfile } from '../server/casinoOutcomeGames.js';
import { mulberry32 } from '../server/raceOdds.js';
import { SLOT_GAMES } from '../server/slots/games.js';
import { CASINO_GAME_KEYS } from '../server/casinoAccess.js';

const base = { hitFrequency: 0.15, rtp: 0.3, volatility: 5, minBet: 1, maxBet: 5000, maxWinMultiplier: 2000 };
const run = (key, profile, rounds, seed = 3) => {
  const r1 = mulberry32(seed); const r2 = mulberry32(seed + 100);
  const rng = (n) => Math.floor(r1() * n); const game = outcomeGames(rng)[key];
  return simulateProfile({ profile, cal: getCalibration(key), game, rounds, rng, randFloat: () => r2(), drawProfiled, outcomeScale });
};

describe('volatility really changes the payout distribution (RTP stays)', () => {
  for (const key of ['slot:diamond-rush', 'slot:aztec-sun', 'tumble', 'slot:hot-fruits', 'scratch']) {
    it(`${key}: volatility 1 < 3 < 5 in spread (sd), RTP and hit frequency unchanged`, () => {
      const p1 = previewOutcome({ ...base, volatility: 1 }, getCalibration(key));
      const p5 = previewOutcome({ ...base, volatility: 5 }, getCalibration(key));
      const p3 = previewOutcome({ ...base, volatility: 3 }, getCalibration(key));
      expect(p1.volatilitySd).toBeLessThan(p3.volatilitySd);
      expect(p3.volatilitySd).toBeLessThan(p5.volatilitySd);
      for (const p of [p1, p3, p5]) { expect(p.rtp).toBeCloseTo(0.3, 6); expect(p.hitFrequency).toBe(0.15); expect(p.houseEdge).toBeCloseTo(0.7, 6); }
      // measured, not only computed
      const m1 = run(key, { ...base, volatility: 1 }, 60000); const m5 = run(key, { ...base, volatility: 5 }, 60000);
      expect(m1.sd).toBeLessThan(m5.sd);
      expect(m1.max).toBeLessThan(m5.max * 1.01);
    });
  }
});

describe('the Admin preview matches what the simulations measure', () => {
  const N = 120000;
  for (const [key, profile] of [
    ['slot:hot-fruits', base], ['slot:diamond-rush', { ...base, volatility: 2 }], ['slots', { ...base, hitFrequency: 0.3, rtp: 0.7, volatility: 4 }],
    ['tumble', { ...base, volatility: 3 }], ['wheel', base], ['scratch', { ...base, volatility: 1.5 }], ['holdwin', { ...base, hitFrequency: 0.2, rtp: 0.5 }],
  ]) {
    it(`${key} @ hit ${profile.hitFrequency} rtp ${profile.rtp} vol ${profile.volatility}`, () => {
      const pv = previewOutcome(profile, getCalibration(key)); const m = run(key, profile, N);
      expect(Math.abs(m.hit - pv.hitFrequency)).toBeLessThan(5 * Math.sqrt((pv.hitFrequency * (1 - pv.hitFrequency)) / N));
      expect(Math.abs(m.netHit - pv.netWinFrequency)).toBeLessThan(5 * Math.sqrt((pv.netWinFrequency * (1 - pv.netWinFrequency)) / N) + 0.002);
      expect(Math.abs(m.rtp - pv.rtp)).toBeLessThan(5 * (m.sd / Math.sqrt(N)) + 0.01 * pv.rtp);
      pv.buckets.forEach(([, pr], i) => expect(Math.abs(m.buckets[i] - pr)).toBeLessThan(5 * Math.sqrt((pr * (1 - pr)) / N) + 0.002));
      expect(m.max).toBeLessThanOrEqual(profile.maxWinMultiplier + 1e-9);
    });
  }
});

describe('max payout cap keeps the configured RTP exact', () => {
  it('a low cap raises the factor instead of silently lowering the return', () => {
    const cal = getCalibration('slot:diamond-rush');
    const loose = { ...base, hitFrequency: 0.2, rtp: 0.5, maxWinMultiplier: 5000 };
    const tight = { ...loose, maxWinMultiplier: 8 };
    expect(outcomeScale(tight, cal)).toBeGreaterThan(outcomeScale(loose, cal));
    const pv = previewOutcome(tight, cal);
    expect(pv.rtp).toBeCloseTo(0.5, 6); expect(pv.maxPayout).toBeLessThanOrEqual(8 + 1e-9);
    const m = run('slot:diamond-rush', tight, 100000);
    expect(Math.abs(m.rtp - 0.5)).toBeLessThan(5 * (m.sd / Math.sqrt(100000)) + 0.005);
    expect(m.max).toBeLessThanOrEqual(8 + 1e-9);
  });
  it('refuses a max win that makes the RTP impossible', async () => {
    await expect(saveProfile('wheel', { hitFrequency: 0.1, rtp: 0.9, maxWinMultiplier: 5 })).rejects.toThrow(/Max win is too low/);
  });
});

describe('settings & coverage', () => {
  it('volatility is validated (1-5) and only exists for outcome games', () => {
    expect(cleanProfileInput('wheel', { volatility: 3 })).toEqual({ volatility: 3 });
    expect(() => cleanProfileInput('wheel', { volatility: 0 })).toThrow();
    expect(() => cleanProfileInput('wheel', { volatility: 5.5 })).toThrow();
    expect(() => cleanProfileInput('roulette', { volatility: 5 })).toThrow();
  });
  it('every game of the casino has its own profile', () => {
    for (const k of CASINO_GAME_KEYS) expect(REGISTRY[k] || k === 'slots', k).toBeTruthy();
    for (const g of SLOT_GAMES) expect(REGISTRY[`slot:${g.id}`]).toBeTruthy();
  });
  it('dice and cups scale their payouts to the configured RTP; default changes nothing', () => {
    expect(NATURAL_RTP).toEqual({ dice: 0.95, cups: 0.95 });
    expect(rtpFactor('dice', { rtp: 0.95 })).toBe(1);
    expect(rtpFactor('cups', { rtp: 0.475 })).toBeCloseTo(0.5, 9);
    expect(rtpFactor('plinko', { rtp: 0.3 })).toBe(1);
  });
});

describe('the 30 video slots have their own mathematical identity', () => {
  it('every slot has a different pay table, different reel strips and a different measured behaviour', () => {
    expect(SLOT_GAMES).toHaveLength(30);
    expect(new Set(SLOT_GAMES.map((g) => JSON.stringify(g.paytable))).size).toBe(30);
    expect(new Set(SLOT_GAMES.map((g) => JSON.stringify(g.strips))).size).toBe(30);
    expect(new Set(SLOT_GAMES.map((g) => JSON.stringify(g.scatterPay) + g.freeSpinMultiplier + g.wildExpand)).size).toBeGreaterThan(1);
    const fp = SLOT_GAMES.map((g) => { const c = getCalibration(`slot:${g.id}`); return [c.pWin, c.sd, c.max].map((x) => x.toFixed(3)).join('|'); });
    expect(new Set(fp).size).toBe(30);
  });
  it('each slot keeps a natural RTP near 95% (exact calculation)', () => {
    for (const g of SLOT_GAMES) expect(g.rtp).toBeGreaterThan(94.5), expect(g.rtp).toBeLessThan(95.6);
  });
});

describe('RTP, hit frequency and volatility are independent settings', () => {
  const key = (k) => getCalibration(k);
  for (const game of ['wheel', 'slot:hot-fruits', 'tumble', 'scratch']) {
    it(`${game}: every combination keeps its own hit and RTP; only volatility changes the spread; only hit changes how often`, () => {
      const rows = [];
      for (const hitFrequency of [0.1, 0.3]) for (const rtp of [0.4, 0.8]) for (const volatility of [1, 3, 5]) {
        const p = previewOutcome({ ...base, hitFrequency, rtp, volatility }, key(game));
        expect(p.hitFrequency).toBe(hitFrequency); expect(p.rtp).toBeCloseTo(rtp, 6);
        rows.push({ hitFrequency, rtp, volatility, sd: p.volatilitySd, net: p.netWinFrequency });
      }
      for (const hitFrequency of [0.1, 0.3]) for (const rtp of [0.4, 0.8]) {
        const sds = [1, 3, 5].map((v) => rows.find((r) => r.hitFrequency === hitFrequency && r.rtp === rtp && r.volatility === v).sd);
        expect(sds[0]).toBeLessThan(sds[2]);
      }
      // more hits at the same RTP -> smaller average win -> fewer wins above the stake per hit
      const a = rows.find((r) => r.hitFrequency === 0.1 && r.rtp === 0.4 && r.volatility === 5); const b = rows.find((r) => r.hitFrequency === 0.3 && r.rtp === 0.4 && r.volatility === 5);
      expect(b.net / 0.3).toBeLessThan(a.net / 0.1);
    });
    it(`${game}: measured results follow the corners of the grid`, () => {
      for (const [hitFrequency, rtp, volatility] of [[0.1, 0.4, 1], [0.3, 0.8, 5], [0.3, 0.4, 3]]) {
        const profile = { ...base, hitFrequency, rtp, volatility }; const N = 60000;
        const m = run(game, profile, N, 9);
        expect(Math.abs(m.hit - hitFrequency)).toBeLessThan(5 * Math.sqrt((hitFrequency * (1 - hitFrequency)) / N));
        expect(Math.abs(m.rtp - rtp)).toBeLessThan(5 * (m.sd / Math.sqrt(N)) + 0.015 * rtp);
      }
    });
  }
});

describe('bet limits apply to the total of the bet, whatever shape the request has', () => {
  it('stake, bets object (roulette, live tables), garbage', () => {
    expect(betTotalOf({ stake: 25 })).toBe(25);
    expect(betTotalOf({ bets: { RED: 10, 17: 5.5, BLACK: 0.1 } })).toBe(15.6);
    expect(betTotalOf({ bets: {} })).toBeNull(); expect(betTotalOf({ bets: [1, 2] })).toBeNull(); expect(betTotalOf({ bets: { A: '5' } })).toBeNull();
    expect(betTotalOf({ bets: { A: NaN } })).toBeNull(); expect(betTotalOf(undefined)).toBeNull(); expect(betTotalOf({})).toBeNull();
    const profile = { minBet: 5, maxBet: 100 };
    expect(validBet(profile, betTotalOf({ bets: { RED: 60, BLACK: 60 } }))).toBe(false);
    expect(validBet(profile, betTotalOf({ bets: { RED: 20, BLACK: 30 } }))).toBe(true);
    expect(validBet(profile, betTotalOf({ stake: 4 }))).toBe(false);
  });
});

describe('each game has its own base numbers (no shared tables without a reason)', () => {
  it('dogs and horses start from different chances; outcome games have different measured fingerprints', async () => {
    const { DOGS } = await import('../server/dogs.js'); const { HORSES } = await import('../server/horses.js');
    expect(DOGS.map((d) => d.p).join()).not.toBe(HORSES.map((h) => h.p).join());
    const fp = Object.keys(outcomeGames(() => 0)).map((k) => { const c = getCalibration(k); return [c.pWin, c.sd, c.max].map((x) => x.toFixed(3)).join('|'); });
    expect(new Set(fp).size).toBe(fp.length);
  });
});
