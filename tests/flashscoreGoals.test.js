import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = { events: [], match: { id: 'l365-1', home_team: 'Bayern', away_team: 'PSG', start_time: new Date(Date.now() - 3600e3).toISOString(), status: 'LIVE' }, other: [] };
vi.mock('../server/db.js', () => {
  const query = async (sql, p = []) => {
    if (/FROM matches_cache/.test(sql)) return { rows: [db.match] };
    if (/SELECT id, team, player, detail FROM match_events/.test(sql)) { return { rows: db.events.filter((x) => x.type === p[1]).map((x) => ({ ...x })) }; }
    if (/UPDATE match_events SET player/.test(sql)) { db.events.find((x) => x.id === p[0]).player = p[1]; return { rows: [] }; }
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

describe('Flashscore: scorer names only', () => {
  beforeEach(() => { db.events = []; db.other = []; __resetForTests(); process.env.FLASHSCORE_URL = 'http://fs:8000'; });
  it('fills only the scorer name of a goal the provider logged; minute and half stay the provider\'s', async () => {
    db.events.push({ id: 1, type: 'GOAL', team: 'Bayern', player: null, detail: '1-0', half: 1, minute: 46 });
    const r = await runFlashscore({ fetchImpl: mk({ periods: [{ period: '2nd Half', incidents: [goal(52)] }] }) });
    expect(r).toMatchObject({ matched: 1, named: 1 });
    expect(db.events[0]).toMatchObject({ player: 'Kane H.', minute: 46, half: 1 });
  });
  it('never adds a goal the provider did not log and never touches anything else', async () => {
    const r = await runFlashscore({ fetchImpl: mk({ periods: [{ period: '1st Half', incidents: [goal(20)] }] }) });
    expect(r.named).toBe(0);
    expect(db.events).toHaveLength(0);
    expect(db.other.some((s) => /matches_cache SET/.test(s))).toBe(false);
  });
  it('does not overwrite a name that is already there', async () => {
    db.events.push({ id: 1, type: 'GOAL', team: 'Bayern', player: 'Other P.', detail: '1-0', minute: 20, half: 1 });
    await runFlashscore({ fetchImpl: mk({ periods: [{ period: '1st Half', incidents: [goal(20)] }] }) });
    expect(db.events[0].player).toBe('Other P.');
  });
  it('a scored penalty that arrives as "Penalty Awarded" still gives its name when it makes the score add up', async () => {
    db.events.push({ id: 1, type: 'GOAL', team: 'Bayern', player: null, detail: '1-0', minute: 10, half: 1 });
    await runFlashscore({ fetchImpl: mk({ periods: [{ period: '1st Half', incidents: [{ team: 'home', minute: "10'", minute_number: 10, type: 'Penalty Awarded', player: { name: 'Kane H.' } }] }] }) });
    expect(db.events[0].player).toBe('Kane H.');
  });
  it('incidents that contradict the score name nothing', async () => {
    db.events.push({ id: 1, type: 'GOAL', team: 'Bayern', player: null, detail: '1-0', minute: 20, half: 1 });
    await runFlashscore({ fetchImpl: mk({ periods: [{ period: '1st Half', incidents: [goal(20), goal(30)] }] }) });
    expect(db.events[0].player).toBeNull();
  });
  it('a failing service is an error for the cycle, not a write', async () => {
    await expect(runFlashscore({ fetchImpl: async () => ({ ok: false, status: 502 }) })).rejects.toThrow(/502/);
  });
});
