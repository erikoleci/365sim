import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = { events: [], match: { id: 'l365-1', home_team: 'Bayern', away_team: 'PSG', start_time: new Date(Date.now() - 3600e3).toISOString(), status: 'LIVE' }, other: [] };
vi.mock('../server/db.js', () => {
  const query = async (sql, p = []) => {
    if (/FROM matches_cache/.test(sql)) return { rows: [db.match] };
    if (/SELECT id, player, minute, half FROM match_events/.test(sql)) { const e = db.events.find((x) => x.type === p[1] && x.team === p[2] && x.detail === p[3]); return { rows: e ? [e] : [] }; }
    if (/UPDATE match_events SET/.test(sql)) {
      const e = db.events.find((x) => x.id === p[0]);
      const re = /(player|minute|half) = \$(\d+)/g; let m; while ((m = re.exec(sql))) e[m[1]] = p[Number(m[2]) - 1];
      return { rows: [] };
    }
    if (/INSERT INTO match_events/.test(sql)) { db.events.push({ id: db.events.length + 1, type: p[2], team: p[3], player: p[4], detail: p[5], minute: p[1], half: p[7], created_at: p[6] }); return { rows: [] }; }
    db.other.push(sql);
    return { rows: [] };
  };
  return { pool: { query }, default: { query } };
});
const { runFlashscore, __resetForTests } = await import('../server/flashscore.js');

const list = (h = 1, a = 0) => ({ competitions: [{ competition: { name: 'UCL' }, matches: [{ id: 'fs1', start_time: db.match.start_time, home: { name: 'Bayern' }, away: { name: 'PSG' }, home_score: h, away_score: a }] }] });
const mk = (summary, l = list()) => async (url) => ({ ok: true, json: async () => (url.includes('/matches/summary') ? summary : l) });
const goal = (min, per, extra = {}) => ({ team: 'home', minute: `${min}'`, minute_number: min, type: 'Goal', player: { name: 'Kane H.' }, ...extra });

describe('Flashscore goals only', () => {
  beforeEach(() => { db.events = []; db.other = []; __resetForTests(); process.env.FLASHSCORE_URL = 'http://fs:8000'; });
  it('fills the scorer, the real minute and the half of a goal our provider logged; no duplicate', async () => {
    db.events.push({ id: 1, type: 'GOAL', team: 'Bayern', player: null, detail: '1-0', half: 1, minute: 46 });
    const r = await runFlashscore({ fetchImpl: mk({ periods: [{ period: '2nd Half', incidents: [goal(52)] }] }) });
    expect(r).toMatchObject({ matched: 1, goalsFixed: 1, goalsAdded: 0 });
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({ player: 'Kane H.', minute: 52, half: 2 });
  });
  it('adds a goal the provider never logged, in its place in time, and writes nothing but GOAL rows', async () => {
    const r = await runFlashscore({ fetchImpl: mk({ periods: [{ period: '1st Half', incidents: [goal(20), { team: 'away', minute: "30'", minute_number: 30, type: 'Yellow Card', player: { name: 'X' } }] }] }) });
    expect(r.goalsAdded).toBe(1);
    expect(db.events.map((e) => e.type)).toEqual(['GOAL']);
    expect(db.events[0]).toMatchObject({ team: 'Bayern', detail: '1-0', half: 1, minute: 20 });
    expect(db.other.some((s) => /matches_cache SET/.test(s))).toBe(false);
  });
  it('a scored penalty that arrives as "Penalty Awarded" becomes a goal when it makes the score add up', async () => {
    const r = await runFlashscore({ fetchImpl: mk({ periods: [{ period: '1st Half', incidents: [{ team: 'home', minute: "10'", minute_number: 10, type: 'Penalty Awarded', player: { name: 'Kane H.' } }] }] }) });
    expect(r.goalsAdded).toBe(1);
    expect(db.events[0]).toMatchObject({ type: 'GOAL', player: 'Kane H.' });
  });
  it('incidents that contradict the score write nothing', async () => {
    await runFlashscore({ fetchImpl: mk({ periods: [{ period: '1st Half', incidents: [goal(20), goal(30)] }] }) });
    expect(db.events).toHaveLength(0);
  });
  it('a failing service is an error for the cycle, not a write', async () => {
    await expect(runFlashscore({ fetchImpl: async () => ({ ok: false, status: 502 }) })).rejects.toThrow(/502/);
    expect(db.events).toHaveLength(0);
  });
});
