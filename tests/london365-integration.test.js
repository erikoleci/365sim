import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked end-to-end provider integration: REST import, live polling, goal
// deduplication, incomplete-response protection, and Socket.IO message
// handlers, all against an in-memory fake of the matches_cache tables.
const mocks = vi.hoisted(function () {
  const store = new Map();
  const oddsHistory = [];
  const matchEvents = [];
  const liveStats = new Map();
  const kv = {};

  function query(sql, params) {
    const s = String(sql);
    if (s.indexOf('SELECT raw_json') === 0) {
      const row = store.get(params[0]);
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (s.indexOf('INSERT INTO matches_cache') === 0) {
      store.set(params[0], {
        id: params[0], league: params[1], home_team: params[2], away_team: params[3],
        start_time: params[4], status: params[5], raw_json: params[6], fetched_at: params[7],
        live_home_score: params[8], live_away_score: params[9], live_minute: params[10], live_status: params[11],
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (s.indexOf('UPDATE matches_cache SET raw_json') === 0) {
      const row = store.get(params[0]);
      if (row) { row.raw_json = params[1]; row.fetched_at = params[2]; }
      return Promise.resolve({ rows: [], rowCount: row ? 1 : 0 });
    }
    if (s.indexOf('UPDATE matches_cache SET status') === 0) {
      const row = store.get(params[0]);
      let updated = 0;
      if (row) {
        if (row.status === 'LIVE') {
          row.status = 'FINISHED';
          row.live_status = 'ended';
          updated = 1;
        }
      }
      return Promise.resolve({ rows: [], rowCount: updated });
    }
    if (s.indexOf('INSERT INTO odds_history') === 0) {
      oddsHistory.push({
        matchId: params[0], marketId: params[1], selectionId: params[2],
        oldOdds: params[3], newOdds: params[4],
        reason: s.indexOf('london365_socket') !== -1 ? 'socket' : 'refresh',
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (s.indexOf('INSERT INTO match_events') === 0) {
      // Params: (id, minute, team, detail, now). The GOAL type is a SQL literal.
      matchEvents.push({ matchId: params[0], minute: params[1], team: params[2], detail: params[3] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (s.indexOf('INSERT INTO live_statistics') === 0) {
      liveStats.set(params[0], { home: params[1], away: params[2] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  return {
    store: store, oddsHistory: oddsHistory, matchEvents: matchEvents, liveStats: liveStats, kv: kv, query: query,
    getKV: function (key, def) { return Promise.resolve(key in kv ? kv[key] : def); },
    setKV: function (key, val) { kv[key] = val; return Promise.resolve(val); },
  };
});

vi.mock('../server/db.js', function () {
  return { default: { query: mocks.query }, getKV: mocks.getKV, setKV: mocks.setKV };
});
vi.mock('../server/ws.js', function () {
  return { pushOddsChanged: vi.fn(), pushGoal: vi.fn() };
});

import {
  importLondon365,
  syncLondon365Live,
  applySocketCoefs,
  applySocketGame,
  markLondon365GameEnded,
  removeSocketCoef,
} from '../server/london365.js';
import { pushGoal, pushOddsChanged } from '../server/ws.js';

const PREMATCH_ODD = '1|1.9|1|55|Rezultati Final,2|3.5|X|55|Rezultati Final,3|4.1|2|55|Rezultati Final';

function jsonResponse(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: function () { return Promise.resolve(JSON.stringify(data)); },
  });
}

let liveGames;

beforeEach(function () {
  mocks.store.clear();
  mocks.oddsHistory.length = 0;
  mocks.matchEvents.length = 0;
  mocks.liveStats.clear();
  Object.keys(mocks.kv).forEach(function (k) { delete mocks.kv[k]; });
  vi.clearAllMocks();
  liveGames = [{
    id: 200, league: 'Serie A', name: 'X vs Y', home_team: 'X', away_team: 'Y',
    game_date: '2026-09-03', game_time: '18:00', result: '1-0',
    current_minute: '48:37', api_status: 2,
    odd: '10|1.8|1|55,11|3.4|X|55',
  }];
  global.fetch = vi.fn(function (url) {
    const pathname = new URL(url).pathname;
    if (pathname === '/ajax/leagues/1') return jsonResponse([{ id: 11, name: 'Premier League' }]);
    if (pathname === '/ajax/gamesByLeague/11') {
      return jsonResponse([{ id: 100, home_team: 'Arsenal', away_team: 'Chelsea', game_date: '2026-09-05', game_time: '18:00', odd: PREMATCH_ODD }]);
    }
    if (pathname === '/ajax/prematchgame/100') {
      return jsonResponse([[
        { id: '1', odd: '1.9', market_option: '1', market_id: '55', market: 'Rezultati Final' },
        { id: '2', odd: '3.5', market_option: 'X', market_id: '55', market: 'Rezultati Final' },
        { id: '3', odd: '4.1', market_option: '2', market_id: '55', market: 'Rezultati Final' },
      ]]);
    }
    if (pathname === '/ajax/livegames') return jsonResponse(liveGames);
    return jsonResponse([]);
  });
});

describe('london365 REST import', function () {
  it('imports every market from the detail endpoint into matches_cache', async function () {
    const res = await importLondon365({ sports: [1], full: true });
    expect(res.matches).toBe(1);
    expect(res.coefficients).toBe(3);
    const row = mocks.store.get('l365-100');
    expect(row).toBeTruthy();
    expect(row.status).toBe('UPCOMING');
    const ev = JSON.parse(row.raw_json);
    expect(ev.bookmakers[0].markets[0].key).toBe('h2h');
    expect(ev.bookmakers[0].markets[0].outcomes).toHaveLength(3);
  });
});

describe('london365 live sync and goal dedup', function () {
  it('persists score, minute and provider status, then records goals only on change', async function () {
    await syncLondon365Live();
    const row = mocks.store.get('l365-200');
    expect(row.live_home_score).toBe(1);
    expect(row.live_away_score).toBe(0);
    expect(row.live_minute).toBe('48:37');
    expect(row.live_status).toBe('2');
    expect(mocks.matchEvents).toHaveLength(1);
    expect(pushGoal).toHaveBeenCalledTimes(1);

    // Same score on the next poll: no duplicate event or notification.
    await syncLondon365Live();
    expect(mocks.matchEvents).toHaveLength(1);
    expect(pushGoal).toHaveBeenCalledTimes(1);

    // Score moves 1-0 to 2-0: one new goal attributed to the home side.
    liveGames = [Object.assign({}, liveGames[0], { result: '2-0', current_minute: '63:10' })];
    await syncLondon365Live();
    expect(mocks.matchEvents).toHaveLength(2);
    expect(mocks.matchEvents[1].team).toBe('X');
    expect(mocks.matchEvents[1].minute).toBe(63);
    expect(pushGoal).toHaveBeenCalledTimes(2);
    expect(mocks.liveStats.get('l365-200')).toEqual({ home: 2, away: 0 });
  });
});

describe('london365 Socket.IO handlers', function () {
  it('applySocketGame persists a new live game from new-live-game', async function () {
    const ok = await applySocketGame(liveGames[0], 'LIVE');
    expect(ok).toBe(true);
    expect(mocks.store.get('l365-200').status).toBe('LIVE');
  });

  it('applySocketCoefs patches prices, logs history, and notifies once', async function () {
    await syncLondon365Live();
    const n = await applySocketCoefs(200, [{ coef_id: '10', coef: 1.6 }, { coef_id: '11', coef: 3.4 }]);
    expect(n).toBe(1);
    let logged = false;
    for (const h of mocks.oddsHistory) {
      if (h.reason === 'socket') {
        if (h.newOdds === 1.6) logged = true;
      }
    }
    expect(logged).toBe(true);
    expect(pushOddsChanged).toHaveBeenCalledTimes(1);
    const ev = JSON.parse(mocks.store.get('l365-200').raw_json);
    const outcome = ev.bookmakers[0].markets[0].outcomes.find(function (o) { return o.id === '10'; });
    expect(outcome.price).toBe(1.6);
  });

  it('markLondon365GameEnded finishes a live match from delete-live-game', async function () {
    await syncLondon365Live();
    const rows = await markLondon365GameEnded(200);
    expect(rows).toBe(1);
    expect(mocks.store.get('l365-200').status).toBe('FINISHED');
  });

  it('removeSocketCoef withdraws a single selection from delete-live-coef', async function () {
    await syncLondon365Live();
    const removed = await removeSocketCoef(200, '11');
    expect(removed).toBe(1);
    const ev = JSON.parse(mocks.store.get('l365-200').raw_json);
    expect(ev.bookmakers[0].markets[0].outcomes.map(function (o) { return o.id; })).toEqual(['10']);
  });

  it('an incomplete live payload never overwrites richer cached odds', async function () {
    await importLondon365({ sports: [1], full: true });
    const partial = {
      id: 100, home_team: 'Arsenal', away_team: 'Chelsea',
      game_date: '2026-09-05', game_time: '18:00',
      league: 'Premier League', odd: '1|1.95|1|55',
    };
    await applySocketGame(partial, 'UPCOMING');
    const ev = JSON.parse(mocks.store.get('l365-100').raw_json);
    expect(ev.bookmakers[0].markets[0].outcomes).toHaveLength(3);
  });
});