import { describe, it, expect, vi, beforeEach } from 'vitest';

// SOURCE-LEVEL catalogue filtering: with NO relevant env vars set, only England,
// France, Spain, Italy, Germany + UCL / UEL / Nations League may be requested
// from the provider and written to matches_cache. Everything else must be
// rejected BEFORE any games request or database write.
vi.hoisted(function () {
  delete process.env.LONDON365_ONLY_COUNTRIES;
  delete process.env.LONDON365_SPORTS;
  delete process.env.LONDON365_MAJOR_ONLY;
  delete process.env.LONDON365_FULL;
  delete process.env.LONDON365_LEAGUES;
  delete process.env.LONDON365_INTERNATIONAL_EXTRA;
  process.env.LONDON365_DETAIL_DELAY_MS = '0';
  return true;
});

const mocks = vi.hoisted(function () {
  const inserted = new Map(); // matches_cache id -> league key
  const kv = {};
  const query = vi.fn(function (sql, params) {
    const s = String(sql);
    if (s.indexOf('INSERT INTO matches_cache') === 0) { inserted.set(params[0], params[1]); return Promise.resolve({ rows: [], rowCount: 1 }); }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { inserted, kv, query };
});
vi.mock('../server/db.js', () => ({
  default: { query: mocks.query },
  getKV: (k, d) => Promise.resolve(k in mocks.kv ? mocks.kv[k] : d),
  setKV: (k, v) => { mocks.kv[k] = v; return Promise.resolve(v); },
}));
vi.mock('../server/ws.js', () => ({ pushOddsChanged: vi.fn(), pushGoal: vi.fn(), pushGoalDisallowed: vi.fn(), pushMatchEnded: vi.fn() }));
vi.mock('../server/matchSettlement.js', () => ({ settleMatch: vi.fn() }));

const l365 = await import('../server/london365.js');

const ODD = '1|1.9|1|55|Rezultati Final,2|3.5|X|55|Rezultati Final,3|4.1|2|55|Rezultati Final';
const future = () => new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const L = (id, name, country_id) => ({ id, name, country_id: String(country_id) });

// provider fixture: country_id -> leagues
const LEAGUES = {
  64: [L(1, 'Premier League', 64), L(2, 'Championship', 64), L(3, 'U23 Premier League 2', 64), L(4, 'National League North', 64), L(5, "Women's Super League", 64), L(6, 'Club Friendlies', 64)],
  32: [L(10, 'Ligue 1', 32), L(11, 'National 3', 32), L(12, 'Ligue 2', 32)],
  85: [L(20, 'La Liga', 85), L(21, 'Tercera RFEF', 85)],
  57: [L(30, 'Serie A', 57), L(31, 'Serie D', 57), L(32, 'Primavera U19', 57)],
  34: [L(40, 'Bundesliga', 34), L(41, 'Regionalliga West', 34), L(42, '2. Bundesliga', 34)],
  13: [L(50, 'UEFA Champions League', 13), L(51, 'UEFA Europa League', 13), L(52, 'UEFA Nations League', 13),
       L(53, 'Copa Libertadores', 13), L(54, 'CONCACAF Nations League', 13), L(55, 'UEFA Youth League', 13),
       L(56, 'International Friendlies', 13), L(57, 'FIFA World Cup', 13)],
  19: [],
  // unwanted countries -- none of these may ever be requested
  900: [L(900, 'Zambia Super League', 900)], 901: [L(901, 'Indian Super League', 901)],
  902: [L(902, 'Uzbekistan Super League', 902)], 903: [L(903, 'V.League 1', 903)],
  904: [L(904, 'Portugal U23 League', 904)], 905: [L(905, 'Denmark Reserves League', 905)],
  906: [L(906, 'China U20 League', 906)], 36: [L(360, 'Paraguay Primera', 36)],
  121: [L(1210, 'Serbian SuperLiga', 121)], 93: [L(930, 'Primeira Liga', 93)],
};
const WANTED = [1, 10, 20, 30, 40, 50, 51, 52]; // top flight only (default); 2/12/42 = Championship/Ligue 2/2. Bundesliga
const UNWANTED = [2, 3, 4, 5, 6, 11, 12, 21, 31, 32, 41, 42, 53, 54, 55, 56, 57, 900, 901, 902, 903, 904, 905, 906, 360, 1210, 930];

function json(data) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) }); }
let requested;
function installProvider() {
  requested = [];
  global.fetch = vi.fn(function (url) {
    const path = new URL(url).pathname;
    requested.push(path);
    if (path === '/ajax/countries/1') {
      return json([
        { id: 900, name: 'Zambia' }, { id: 901, name: 'India' }, { id: 902, name: 'Uzbekistan' }, { id: 903, name: 'Vietnam' },
        { id: 904, name: 'Portugal U23' }, { id: 905, name: 'Denmark Reserves' }, { id: 906, name: 'China U20' },
      ]);
    }
    let m = /^\/ajax\/leagues\/(\d+)$/.exec(path);
    if (m) return json(LEAGUES[m[1]] || []);
    m = /^\/ajax\/gamesByLeague\/(\d+)$/.exec(path);
    if (m) {
      const id = Number(m[1]);
      const all = Object.values(LEAGUES).flat();
      const lg = all.find((x) => Number(x.id) === id);
      return json(lg ? [{ id: id * 10, home_team: 'H' + id, away_team: 'A' + id, game_date: future(), game_time: '18:00', odd: ODD, country: '', country_id: lg.country_id }] : []);
    }
    if (/^\/ajax\/prematchgame\/\d+$/.test(path)) {
      return json([[{ id: '1', odd: '1.9', market_option: '1', market_id: '55', market: 'Rezultati Final' }, { id: '2', odd: '3.5', market_option: 'X', market_id: '55', market: 'Rezultati Final' }, { id: '3', odd: '4.1', market_option: '2', market_id: '55', market: 'Rezultati Final' }]]);
    }
    return json([]);
  });
}
const gamesRequestedFor = () => requested.filter((p) => p.startsWith('/ajax/gamesByLeague/')).map((p) => Number(p.split('/').pop()));
const leaguesRequestedFor = () => requested.filter((p) => p.startsWith('/ajax/leagues/')).map((p) => Number(p.split('/').pop()));

beforeEach(() => { mocks.inserted.clear(); mocks.query.mockClear(); Object.keys(mocks.kv).forEach((k) => delete mocks.kv[k]); installProvider(); });

describe('default configuration (no env vars) is the explicit catalogue', () => {
  it('whitelist is ON by default: five countries + International, Soccer only, MAJOR_ONLY on', () => {
    const c = l365.getLondon365FilterConfig();
    expect(c.whitelistActive).toBe(true);
    expect(c.onlyCountries.sort()).toEqual(['england', 'france', 'germany', 'international', 'italy', 'spain']);
    expect(c.sports).toBe('1');
    expect(c.majorOnly).toBe(true);
    expect(c.internationalExtra).toBeNull(); // FIFA/World Cup etc. are opt-in, not default
  });
});

describe('prematch import rejects unwanted matches BEFORE any request or DB write', () => {
  for (const full of [true, false]) {
    it(`LONDON365_FULL=${full ? 1 : 0}: imports exactly the wanted leagues and touches nothing else`, async () => {
      await l365.importLondon365({ sports: [1], full });
      const importedLeagueIds = Array.from(mocks.inserted.keys()).map((id) => Number(id.replace('l365-', '')) / 10).sort((a, b) => a - b);
      expect(importedLeagueIds).toEqual(WANTED);
      // only the 7 allowed country buckets were asked for their leagues...
      expect(leaguesRequestedFor().sort((a, b) => a - b)).toEqual([13, 19, 32, 34, 57, 64, 85]);
      // ...and games were only ever requested for wanted leagues
      expect(gamesRequestedFor().sort((a, b) => a - b)).toEqual(WANTED);
      for (const id of UNWANTED) expect(gamesRequestedFor()).not.toContain(id);
    });
  }

  it('FULL=1 and FULL=0 accept exactly the same set of matches (FULL never bypasses the filter)', async () => {
    await l365.importLondon365({ sports: [1], full: true });
    const withFull = Array.from(mocks.inserted.keys()).sort();
    mocks.inserted.clear(); installProvider();
    await l365.importLondon365({ sports: [1], full: false });
    expect(Array.from(mocks.inserted.keys()).sort()).toEqual(withFull);
  });

  it('LONDON365_LEAGUES cap is applied AFTER filtering: it can only trim wanted leagues', async () => {
    await l365.importLondon365({ sports: [1], full: false, leagues: 4 });
    const requestedGames = gamesRequestedFor();
    expect(requestedGames).toHaveLength(4);
    for (const id of requestedGames) expect(WANTED).toContain(id);
    // International's wanted leagues sort first; before this fix the unwanted
    // International leagues (Libertadores, CONCACAF...) used up the cap slots.
    for (const uefa of [50, 51, 52]) expect(requestedGames).toContain(uefa);
  });

  it('keeps Champions League, Europa League and Nations League; rejects other confederations, youth and friendlies', async () => {
    await l365.importLondon365({ sports: [1], full: false });
    const keys = Array.from(mocks.inserted.values());
    for (const name of ['uefa_champions_league', 'uefa_europa_league', 'uefa_nations_league']) {
      expect(keys.some((k) => k.endsWith('__' + name)), name).toBe(true);
    }
    for (const bad of ['copa_libertadores', 'concacaf_nations_league', 'uefa_youth_league', 'international_friendlies', 'fifa_world_cup']) {
      expect(keys.some((k) => k.endsWith('__' + bad)), bad).toBe(false);
    }
  });

  it('keeps ONLY the top flight of the five countries by default, drops second tier/regional/lower/youth/women\'s', async () => {
    await l365.importLondon365({ sports: [1], full: false });
    const leagueIds = Array.from(mocks.inserted.keys()).map((id) => Number(id.replace('l365-', '')) / 10);
    for (const kept of [1, 10, 20, 30, 40]) expect(leagueIds).toContain(kept); // PL, L1, La Liga, Serie A, Bundesliga
    for (const dropped of [2, 3, 4, 5, 6, 11, 12, 21, 31, 32, 41, 42]) expect(leagueIds).not.toContain(dropped); // incl. Championship/L2/BL2
  });
});

describe('live entry points apply the same rule (no import needed)', () => {
  const g = (league) => ({ league });
  it('drops unresolved youth / reserve / lower-tier names even when the country token is whitelisted', () => {
    for (const n of ['England U23 Premier League 2', 'Spain Reserves', 'Germany Regionalliga West', 'Italy Primavera U19', 'France National 3']) {
      expect(l365.isAllowedByCountryFilter(g(n), null), n).toBe(false);
    }
  });
  it('drops unwanted countries and confederations', () => {
    for (const n of ['Zambia Super League', 'India Super League', 'Uzbekistan Super League', 'Serbia SuperLiga', 'Portugal Primeira Liga', 'CONCACAF Nations League', 'AFC Champions League']) {
      expect(l365.isAllowedByCountryFilter(g(n), null), n).toBe(false);
    }
  });
  it('keeps the five countries and the three UEFA competitions', () => {
    for (const n of ['England Premier League', 'Spain La Liga', 'Italy Serie A', 'Germany Bundesliga', 'France Ligue 1', 'UEFA Champions League', 'UEFA Europa League', 'UEFA Nations League']) {
      expect(l365.isAllowedByCountryFilter(g(n), null), n).toBe(true);
    }
  });
});
