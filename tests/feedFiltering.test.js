import { describe, it, expect, vi, beforeEach } from 'vitest';

// Env is read at module load, so set it before london365.js is imported.
const env = vi.hoisted(function () {
  process.env.LONDON365_ONLY_COUNTRIES = 'england,spain,italy,germany,france';
  return true;
});

const mocks = vi.hoisted(function () {
  const queries = [];
  const query = vi.fn(function (sql, params) {
    queries.push({ sql: String(sql), params });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { queries, query };
});
vi.mock('../server/db.js', function () {
  return { default: { query: mocks.query }, getKV: vi.fn(), setKV: vi.fn() };
});
vi.mock('../server/ws.js', function () {
  return { pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() };
});
vi.mock('../server/matchSettlement.js', function () { return { settleMatch: vi.fn() }; });

// mockImplementation would replace the recorder above, so route every override
// through this helper, which records first and then delegates.
function respondWith(fn) {
  mocks.query.mockImplementation(function (sql, params) {
    mocks.queries.push({ sql: String(sql), params });
    return fn(String(sql), params);
  });
}

const l365 = await import('../server/london365.js');
const tracker = await import('../server/liveTracker.js');

beforeEach(() => { mocks.queries.length = 0; mocks.query.mockClear(); tracker.__resetLiveTrackerForTests(); });

const known = (countryName, name) => ({ countryName, name, key: 'k', id: '1', countryId: '1' });

describe('isAllowedInternationalCompetition', () => {
  it('keeps UEFA competitions (prefixed or bare) and FIFA / World Cup', () => {
    for (const n of ['UEFA Champions League', 'Champions League', 'Europa League', 'Conference League',
      'Nations League', 'UEFA Nations League', 'FIFA World Cup', 'World Cup Qualification Europe', 'FIFA Club World Cup']) {
      expect(l365.isAllowedInternationalCompetition(n), n).toBe(true);
    }
  });
  it('still rejects other confederations\' club competitions', () => {
    for (const n of ['Copa Libertadores', 'Copa Sudamericana', 'AFC Champions League', 'CAF Champions League']) {
      expect(l365.isAllowedInternationalCompetition(n), n).toBe(false);
    }
  });
});

describe('isAllowedByCountryFilter (shared by the live REST loop and the socket handlers)', () => {
  it('allows the five countries and drops everything else', () => {
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('England', 'Premier League'))).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('Spain', 'La Liga'))).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('India', 'Indian Super League'))).toBe(false);
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('Portugal', 'Primeira Liga'))).toBe(false);
  });
  it('inside International, keeps UEFA / FIFA competitions and drops the rest', () => {
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('International', 'Champions League'))).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('International', 'FIFA World Cup'))).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('International', 'Copa Libertadores'))).toBe(false);
  });
  it('drops youth / women variants of an allowed competition', () => {
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('International', 'UEFA Youth League'))).toBe(false);
    expect(l365.isAllowedByCountryFilter({ league: 'x' }, known('International', 'UEFA Women\'s Champions League'))).toBe(false);
  });
  it('an UNRESOLVED league is judged by its name: a UEFA competition is kept (used to fall through to token "uefa" and be dropped)', () => {
    expect(l365.isAllowedByCountryFilter({ league: 'UEFA Champions League' }, null)).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'Copa Libertadores' }, null)).toBe(false);
    expect(l365.isAllowedByCountryFilter({ league: 'Spain La Liga' }, null)).toBe(true);
    expect(l365.isAllowedByCountryFilter({ league: 'Poland Cup' }, null)).toBe(false);
  });
});

describe('untracked games never reach the database', () => {
  it('applySocketCoefs / removeSocketCoef / markLondon365GameEnded do zero queries for a game we do not hold', async () => {
    tracker.applyTrackerSnapshot([{ id: 'l365-1', status: 'LIVE' }], Date.now());
    expect(await l365.applySocketCoefs(555, [{ coef_id: '1', coef: 2.0 }])).toBe(0);
    expect(await l365.removeSocketCoef(555, '1')).toBe(0);
    expect(await l365.markLondon365GameEnded(555)).toBe(0);
    expect(mocks.queries).toHaveLength(0);
  });
  it('a tracked game still goes to the database (behaviour unchanged)', async () => {
    tracker.applyTrackerSnapshot([{ id: 'l365-1', status: 'LIVE' }], Date.now());
    await l365.applySocketCoefs(1, [{ coef_id: '1', coef: 2.0 }]);
    expect(mocks.queries.length).toBeGreaterThan(0);
  });
  it('applySocketGame drops a filtered game before building anything or touching the DB', async () => {
    const ok = await l365.applySocketGame({
      id: 9, league: 'Indian Super League', home_team: 'A', away_team: 'B', odd: '1|1.5|1|55', game_date: '2026-09-30', game_time: '18:00',
    }, 'LIVE');
    expect(ok).toBe(false);
    expect(mocks.queries).toHaveLength(0);
  });
});

describe('purgeCountriesNotInOnlyList', () => {
  it('does NOT delete bare-named UEFA competitions (bug: slug used underscores, regex needs spaces)', async () => {
    respondWith(function (s) {
      if (s.startsWith('SELECT DISTINCT league')) {
        return Promise.resolve({ rows: [
          { league: 'l365_international__champions_league' },
          { league: 'l365_international__nations_league' },
          { league: 'l365_international__fifa_world_cup' },
          { league: 'l365_international__copa_libertadores' },
          { league: 'l365_india__indian_super_league' },
          { league: 'l365_england__premier_league' },
        ] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    await l365.purgeCountriesNotInOnlyList();
    const deleted = mocks.queries.filter((q) => q.sql.startsWith('DELETE')).map((q) => q.params[0]);
    expect(deleted.sort()).toEqual(['l365_india__indian_super_league', 'l365_international__copa_libertadores']);
  });
  it('never deletes a match that has a PENDING bet selection', async () => {
    respondWith(function (s) {
      if (s.startsWith('SELECT DISTINCT league')) return Promise.resolve({ rows: [{ league: 'l365_india__x' }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    await l365.purgeCountriesNotInOnlyList();
    const del = mocks.queries.find((q) => q.sql.startsWith('DELETE'));
    expect(del.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM bet_selections/);
    expect(del.sql).toMatch(/status = 'PENDING'/);
  });
});
