import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = { events: [], extra: null, match: { id: 'l365-1', home_team: 'Bayern', away_team: 'PSG', start_time: new Date(Date.now() - 3600e3).toISOString(), status: 'LIVE' } };
vi.mock('../server/db.js', () => {
  const query = async (sql, p = []) => {
    if (/FROM matches_cache/.test(sql)) return { rows: [db.match] };
    if (/SELECT id, player FROM match_events/.test(sql)) { const e = db.events.find((x) => x.type === p[1] && x.team === p[2] && x.detail === p[3]); return { rows: e ? [e] : [] }; }
    if (/UPDATE match_events SET player/.test(sql)) { db.events.find((x) => x.id === p[0]).player = p[1]; return { rows: [] }; }
    if (/INSERT INTO match_events/.test(sql)) { db.events.push({ id: db.events.length + 1, type: p[2], team: p[3], player: p[4], detail: p[5] }); return { rows: [] }; }
    if (/UPDATE matches_cache SET live_status/.test(sql)) { db.closed = p[1]; return { rowCount: 1, rows: [] }; }
    if (/UPDATE matches_cache SET live_minute/.test(sql)) { db.clock = { minute: p[1], status: p[3], staleBefore: p[4] }; return { rowCount: 1, rows: [] }; }
    if (/INSERT INTO match_extra/.test(sql)) { db.extra = { bch: p[1], bca: p[2], stats: p[3] }; return { rows: [] }; }
    return { rows: [] };
  };
  return { pool: { query }, default: { query } };
});
const { runFlashscore, __resetForTests } = await import('../server/flashscore.js');

const list = () => ({ competitions: [{ competition: { name: 'UCL' }, matches: [{ id: 'fs1', start_time: db.match.start_time, home: { name: 'Bayern' }, away: { name: 'PSG' }, home_score: 1, away_score: 0, note: '1st leg' }] }] });
const summary = { periods: [{ period: '1st Half', incidents: [{ team: 'home', minute: '20\'', minute_number: 20, type: 'Goal', player: { name: 'Kane H.' }, reason: 'Penalty' }] }] };
const stats = { periods: [{ period: 'Match', groups: [{ statistics: [{ name: 'Big chances', home: '2', away: '1', home_value: 2, away_value: 1 }, { name: 'Tackles', home: '9', away: '7' }] }] }] };
const fetchImpl = async (url) => ({ ok: true, json: async () => (url.includes('/matches/summary') ? summary : url.includes('/matches/statistics') ? stats : list()) });

describe('Flashscore enrichment loop', () => {
  beforeEach(() => { db.events = []; db.extra = null; db.clock = undefined; db.closed = undefined; __resetForTests(); delete process.env.FLASHSCORE_URL; });
  it('is idle when there is no scraper available (no Python / no URL)', async () => { expect(await runFlashscore({ fetchImpl })).toEqual({ disabled: true }); });
  it('adds scorer + penalty + extras, and fills in a missing scorer name without duplicating', async () => {
    process.env.FLASHSCORE_URL = 'http://fs:8000';
    db.events.push({ id: 1, type: 'GOAL', team: 'Bayern', player: null, detail: '1-0' }); // another source logged the goal without a name
    const r = await runFlashscore({ fetchImpl });
    expect(r).toMatchObject({ matched: 1, extras: 1, eventsAdded: 1 }); // only the PENALTY row is new
    expect(db.events.find((e) => e.type === 'GOAL')).toMatchObject({ player: 'Kane H.' });
    expect(db.events.filter((e) => e.type === 'GOAL')).toHaveLength(1);
    expect(JSON.parse(db.extra.stats).map((x) => x.name)).toEqual(['Big chances', 'Tackles']);
    expect(db.extra).toMatchObject({ bch: 2, bca: 1 });
  });
  it('2nd half on Flashscore closes the first-half markets when our provider never signalled half time', async () => {
    process.env.FLASHSCORE_URL = 'http://fs:8000';
    const second = async (url) => ({ ok: true, json: async () => (url.includes('/matches/summary') ? summary : url.includes('/matches/statistics') ? stats
      : { competitions: [{ competition: { name: 'UCL' }, matches: [{ id: 'fs1', start_time: db.match.start_time, home: { name: 'Bayern' }, away: { name: 'PSG' }, home_score: 1, away_score: 0, stage: '2nd Half', stage_id: 13 }] }] }) });
    db.match = { ...db.match, live_status: '1H', live_minute: '46', ht_home: null, start_time: new Date(Date.now() - 62 * 60000).toISOString() };
    expect((await runFlashscore({ fetchImpl: second })).firstHalfClosed).toBe(1);
    expect(db.closed).toBe('2H');
    __resetForTests(); db.closed = undefined;
    db.match = { ...db.match, live_status: '2H' }; // already past the first half: nothing to write
    expect((await runFlashscore({ fetchImpl: second })).firstHalfClosed).toBeUndefined();
  });
  it('a failing service is an error for the cycle, not a crash or a write', async () => {
    process.env.FLASHSCORE_URL = 'http://fs:8000';
    await expect(runFlashscore({ fetchImpl: async () => ({ ok: false, status: 502 }) })).rejects.toThrow(/502/);
    expect(db.events).toHaveLength(0);
  });
  it('clock fallback: only when our provider clock is stale; never touches a fresh one', async () => {
    process.env.FLASHSCORE_URL = 'http://fs:8000';
    const withStage = (stage, stageId) => async (url) => ({ ok: true, json: async () => (url.includes('/matches/summary') ? summary : url.includes('/matches/statistics') ? stats
      : { competitions: [{ competition: { name: 'UCL' }, matches: [{ id: 'fs1', start_time: db.match.start_time, home: { name: 'Bayern' }, away: { name: 'PSG' }, home_score: 1, away_score: 0, stage, stage_id: stageId }] }] }) });
    db.match = { ...db.match, live_minute_updated_at: Date.now() - 60000 }; // fresh clock
    await runFlashscore({ fetchImpl: withStage('Half Time', 38) });
    expect(db.clock).toBeUndefined();
    __resetForTests();
    db.match = { ...db.match, live_minute_updated_at: Date.now() - 10 * 60000, live_home_score: 0, live_away_score: 0 }; // silent for 10 minutes, our score is behind (0-0 vs 1-0)
    expect((await runFlashscore({ fetchImpl: withStage('Half Time', 38) })).clock).toBeUndefined(); // HT refused: scores differ
    __resetForTests();
    db.match = { ...db.match, live_home_score: 1, live_away_score: 0 }; // same score
    const r = await runFlashscore({ fetchImpl: withStage('Half Time', 38) });
    expect(r.clock).toBe(1);
    expect(db.clock).toMatchObject({ minute: '45', status: 'HT' });
  });
  it('extra time on Flashscore closes our markets (live_status ET) even if our clock is fresh; nothing if already ET', async () => {
    process.env.FLASHSCORE_URL = 'http://fs:8000';
    const et = async (url) => ({ ok: true, json: async () => (url.includes('/matches/summary') ? summary : url.includes('/matches/statistics') ? stats
      : { competitions: [{ competition: { name: 'UCL' }, matches: [{ id: 'fs1', start_time: db.match.start_time, home: { name: 'Bayern' }, away: { name: 'PSG' }, home_score: 1, away_score: 0, stage: 'Extra Time', stage_id: 6 }] }] }) });
    db.match = { ...db.match, live_status: '2H', live_minute_updated_at: Date.now() - 1000 };
    expect((await runFlashscore({ fetchImpl: et })).closed).toBe(1);
    expect(db.closed).toBe('ET');
    __resetForTests(); db.closed = undefined;
    db.match = { ...db.match, live_status: 'ET' };
    expect((await runFlashscore({ fetchImpl: et })).closed).toBeUndefined();
  });
});
