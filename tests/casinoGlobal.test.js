import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory kv_store behind the pool, so the real storage code runs.
const store = new Map();
vi.mock('../server/db.js', () => ({
  default: { query: vi.fn(async (sql, params) => {
    if (/SELECT value FROM kv_store/.test(sql)) return { rows: store.has(params[0]) ? [{ value: store.get(params[0]) }] : [] };
    if (/INSERT INTO kv_store/.test(sql)) { store.set(params[0], params[1]); return { rows: [] }; }
    return { rows: [] };
  }) },
}));
const mod = () => import('../server/casinoProfiles.js');

beforeEach(async () => { store.clear(); const m = await mod(); m.clearProfileCache(); });

describe('global casino setting', () => {
  it('every game with a hit frequency / RTP follows it; games with fixed rules are untouched', async () => {
    const m = await mod();
    await m.saveGlobalProfile({ hitFrequency: 0.2, rtp: 0.4 });
    const slot = await m.getProfile('slot:hot-fruits'); const tumble = await m.getProfile('tumble'); const dice = await m.getProfile('dice'); const roulette = await m.getProfile('roulette');
    expect(slot.hitFrequency).toBe(0.2); expect(slot.rtp).toBe(0.4);
    expect(tumble.hitFrequency).toBe(0.2); expect(tumble.rtp).toBe(0.4);
    expect(dice.rtp).toBe(0.4); expect(dice.hitFrequency).toBeUndefined();
    expect(roulette.rtp).toBeUndefined();
  });
  it('replaces what was saved per game before, but keeps limits and max win', async () => {
    const m = await mod();
    await m.saveProfile('slot:hot-fruits', { hitFrequency: 0.5, rtp: 0.9, minBet: 5, maxWinMultiplier: 3000 });
    await m.saveGlobalProfile({ hitFrequency: 0.2, rtp: 0.4 });
    const p = await m.getProfile('slot:hot-fruits');
    expect(p.hitFrequency).toBe(0.2); expect(p.rtp).toBe(0.4); expect(p.minBet).toBe(5); expect(p.maxWinMultiplier).toBe(3000);
  });
  it('one game can still be tuned apart afterwards', async () => {
    const m = await mod();
    await m.saveGlobalProfile({ hitFrequency: 0.2, rtp: 0.4 });
    await m.saveProfile('slot:hot-fruits', { rtp: 0.7 });
    expect((await m.getProfile('slot:hot-fruits')).rtp).toBe(0.7);
    expect((await m.getProfile('slot:royal-gems')).rtp).toBe(0.4);
  });
  it('refuses values out of range, and changes nothing', async () => {
    const m = await mod();
    await expect(m.saveGlobalProfile({ hitFrequency: 0.99 })).rejects.toThrow(/between/);
    await expect(m.saveGlobalProfile({ rtp: 2 })).rejects.toThrow(/between/);
    await expect(m.saveGlobalProfile({ hitFrequency: 0.95, rtp: 0.05 })).resolves.toBeTruthy();
    store.clear(); (await mod()).clearProfileCache();
    await expect(m.saveGlobalProfile({})).rejects.toThrow(/Nothing/);
    expect(await m.getGlobalProfile()).toEqual({ hitFrequency: null, rtp: null });
  });
});
