import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = { events: [], extra: null, match: { id: 'l365-1', home_team: 'Bayern', away_team: 'PSG', start_time: new Date(Date.now() - 3600e3).toISOString(), status: 'LIVE' } };
vi.mock('../server/db.js', () => {
  const query = async (sql, p = []) => {
    if (/FROM matches_cache/.test(sql)) return { rows: [db.match] };
    if (/SELECT id, player FROM match_events/.test(sql)) { const e = db.events.find((x) => x.type === p[1] && x.team === p[2] && x.detail === p[3]); return { rows: e ? [e] : [] }; }
    if (/UPDATE match_events SET player/.test(sql)) { db.events.find((x) => x.id === p[0]).player = p[1]; return { rows: [] }; }
    if (/INSERT INTO match_events/.test(sql)) { db.events.push({ id: db.events.length + 1, type: p[2], team: p[3], player: p[4], detail: p[5] }); return { rows: [] }; }
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
  beforeEach(() => { db.events = []; db.extra = null; __resetForTests(); delete process.env.FLASHSCORE_URL; });
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
  it('a failing service is an error for the cycle, not a crash or a write', async () => {
    process.env.FLASHSCORE_URL = 'http://fs:8000';
    await expect(runFlashscore({ fetchImpl: async () => ({ ok: false, status: 502 }) })).rejects.toThrow(/502/);
    expect(db.events).toHaveLength(0);
  });
});
