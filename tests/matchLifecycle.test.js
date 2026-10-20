import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory Postgres stand-in, just rich enough for settleMatch /
// recoverFinishedWithoutResult / recomputeBetStatus. Row-level FOR UPDATE on a
// bet is simulated with a per-key mutex released on COMMIT/ROLLBACK, because the
// double-settlement risk is a concurrency race a non-blocking mock would hide.
const mocks = vi.hoisted(function () {
  const matches = new Map();
  const bets = new Map();
  const legs = []; // bet_selections
  const users = new Map();
  const locks = new Map();

  function acquire(key) {
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const held = new Promise((res) => { release = res; });
    locks.set(key, prev.then(() => held));
    return prev.then(() => release);
  }

  function reset() {
    matches.clear(); bets.clear(); legs.length = 0; users.clear(); locks.clear();
  }

  async function run(state, sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s === 'BEGIN') return { rows: [] };
    if (s === 'COMMIT' || s === 'ROLLBACK') {
      for (const held of state.held || []) { held.release(); locks.delete(held.key); }
      state.held = [];
      return { rows: [] };
    }
    if (s.startsWith("SELECT m.id, m.start_time, m.live_home_score")) {
      const pending = new Set(legs.filter((l) => l.status === 'PENDING').map((l) => l.match_id));
      return {
        rows: [...matches.values()].filter((m) =>
          m.status === 'FINISHED' && m.result_home == null && m.result_away == null &&
          m.live_home_score != null && m.live_away_score != null && pending.has(m.id)).map((m) => ({ ...m })),
      };
    }
    if (s === 'SELECT * FROM matches_cache WHERE id = $1') {
      const m = matches.get(params[0]);
      return { rows: m ? [{ ...m }] : [] };
    }
    if (s === "SELECT * FROM bet_selections WHERE match_id = $1 AND status = 'PENDING'") {
      return { rows: legs.filter((l) => l.match_id === params[0] && l.status === 'PENDING').map((l) => ({ ...l })) };
    }
    if (s === "UPDATE bet_selections SET status = $1 WHERE id = $2 AND status = 'PENDING'") {
      const leg = legs.find((l) => l.id === params[1]);
      if (leg && leg.status === 'PENDING') leg.status = params[0];
      return { rows: [] };
    }
    if (s.startsWith("UPDATE matches_cache SET status = 'FINISHED', result_home = $1")) {
      const m = matches.get(params[3]);
      Object.assign(m, { status: 'FINISHED', result_home: params[0], result_away: params[1], settled_at: params[2] });
      return { rows: [] };
    }
    if (s === 'SELECT * FROM bets WHERE id = $1 FOR UPDATE') {
      const key = 'bets:' + params[0];
      const release = await acquire(key);
      (state.held = state.held || []).push({ key, release });
      const b = bets.get(params[0]);
      return { rows: b ? [{ ...b }] : [] };
    }
    if (s === 'SELECT * FROM bet_selections WHERE bet_id = $1') {
      return { rows: legs.filter((l) => l.bet_id === params[0]).map((l) => ({ ...l })) };
    }
    if (s === 'UPDATE bets SET status = $1 WHERE id = $2') {
      bets.get(params[1]).status = params[0];
      return { rows: [] };
    }
    if (s.startsWith('SELECT balance FROM users WHERE id')) {
      const u = users.get(params[0]);
      return { rows: u ? [{ balance: u.balance }] : [] };
    }
    if (s.startsWith('INSERT INTO transactions')) {
      (state.ledger ||= []).push({ user: params[0], amount: Number(params[1]), type: params[2], ref: params[3] });
      return { rows: [] };
    }
    if (s === 'UPDATE users SET balance = balance + $1 WHERE id = $2') {
      users.get(params[1]).balance += Number(params[0]);
      return { rows: [] };
    }
    throw new Error('unmocked query: ' + s);
  }

  const pool = {
    query: (sql, params) => run({}, sql, params),
    connect: async () => {
      const state = {};
      return { query: (sql, params) => run(state, sql, params), release: () => {} };
    },
  };
  return { matches, bets, legs, users, reset, pool };
});

vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { recoverFinishedWithoutResult, canSettleFromLiveScore, settleMatch, SETTLE_MIN_ELAPSED_MS } =
  await import('../server/matchSettlement.js');
const { marketPeriod, isPastFirstHalf, getMarketClosedReason, minuteOf } = await import('../server/marketPeriods.js');
const { mapEventToMatch } = await import('../server/oddsUtils.js');

const NOW = Date.parse('2026-10-14T20:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();

// ---------------------------------------------------------------- market periods
describe('marketPeriod', () => {
  it('recognises first-half and second-half markets (Albanian and English names)', () => {
    expect(marketPeriod('Rezultati Pjesa e Parë')).toBe('H1');
    expect(marketPeriod('Numri i Golave në Pjesën e Parë')).toBe('H1');
    expect(marketPeriod('1X2 1st Half')).toBe('H1');
    expect(marketPeriod('Totali i Golave - Pjesa e Dytë')).toBe('H2');
    expect(marketPeriod('Over/Under 2nd Half')).toBe('H2');
  });
  it('recognises the exact period names the provider uses on real tickets (genitive and Roman numerals)', () => {
    expect(marketPeriod('Rezultati Pjesës së Parë')).toBe('H1');
    expect(marketPeriod('Rezultati Pjesa I')).toBe('H1');
    expect(marketPeriod('Rezultati Pjesa II')).toBe('H2');
    expect(marketPeriod('Rezultati Pjesës së Dytë')).toBe('H2');
  });
  it('leaves full-time, ambiguous and empty names alone', () => {
    expect(marketPeriod('Rezultat Final & Numri i Golave në Ndeshje')).toBeNull();
    expect(marketPeriod('Shuma e korneve P1+P2')).toBeNull();
    expect(marketPeriod('1X2 - Fituesi')).toBeNull();
    expect(marketPeriod('Totali i Golave')).toBeNull();
    expect(marketPeriod('1st half / 2nd half')).toBeNull();
    expect(marketPeriod('')).toBeNull();
    expect(marketPeriod(undefined)).toBeNull();
  });
});

describe('minuteOf', () => {
  it('reads the clock formats the provider sends', () => {
    expect(minuteOf('62:14')).toBe(62);
    expect(minuteOf('45+')).toBe(45);
    expect(minuteOf('90+')).toBe(90);
    expect(minuteOf('73')).toBe(73);
    expect(minuteOf('1776')).toBe(29); // bare seconds counter
    expect(minuteOf('300924')).toBeNull(); // nonsense sentinel
    expect(minuteOf('')).toBeNull();
    expect(minuteOf(null)).toBeNull();
  });
});

describe('isPastFirstHalf', () => {
  const live = (over) => ({ start_time: minutesAgo(30), status: 'LIVE', live_status: '1H', live_minute: '30:00', ...over });
  it('is false before kickoff and during the first half', () => {
    expect(isPastFirstHalf({ start_time: new Date(NOW + 3600000).toISOString(), status: 'UPCOMING' }, NOW)).toBe(false);
    expect(isPastFirstHalf(live(), NOW)).toBe(false);
    expect(isPastFirstHalf(live({ live_minute: '45+', start_time: minutesAgo(47) }), NOW)).toBe(false);
  });
  it('is true at half-time, in the second half, extra time and when finished', () => {
    for (const st of ['HT', 'PAUSED', '2H', 'SECOND_HALF', 'ET', 'PEN', 'FT', 'ended']) {
      expect(isPastFirstHalf(live({ live_status: st, live_minute: null }), NOW)).toBe(true);
    }
    expect(isPastFirstHalf(live({ status: 'FINISHED' }), NOW)).toBe(true);
  });
  it('is true once the clock passes minute 45', () => {
    expect(isPastFirstHalf(live({ live_minute: '46:10', start_time: minutesAgo(65) }), NOW)).toBe(true);
  });
  it('does not trust a stuck "1H": 60+ minutes of real time is always past the first half', () => {
    expect(isPastFirstHalf(live({ live_minute: '38:00', start_time: minutesAgo(75) }), NOW)).toBe(true);
  });
  it('with no live data at all, 50+ minutes after kickoff is past the first half', () => {
    expect(isPastFirstHalf({ start_time: minutesAgo(55), status: 'LIVE' }, NOW)).toBe(true);
    expect(isPastFirstHalf({ start_time: minutesAgo(20), status: 'LIVE' }, NOW)).toBe(false);
  });
});

describe('getMarketClosedReason', () => {
  const ht = { start_time: minutesAgo(52), status: 'LIVE', live_status: 'HT', live_minute: '45:00' };
  it('closes first-half markets at half-time but keeps full-time and second-half markets open', () => {
    expect(getMarketClosedReason(ht, 'Rezultati Pjesa e Parë', NOW)).toBe('FIRST_HALF_OVER');
    expect(getMarketClosedReason(ht, '1X2 - Fituesi', NOW)).toBeNull();
    expect(getMarketClosedReason(ht, 'Totali i Golave - Pjesa e Dytë', NOW)).toBeNull();
  });
  it('keeps first-half markets open during the first half', () => {
    const first = { start_time: minutesAgo(20), status: 'LIVE', live_status: '1H', live_minute: '20:00' };
    expect(getMarketClosedReason(first, 'Rezultati Pjesa e Parë', NOW)).toBeNull();
  });
  it('closes everything once the match is finished', () => {
    const fin = { start_time: minutesAgo(130), status: 'FINISHED' };
    expect(getMarketClosedReason(fin, '1X2 - Fituesi', NOW)).toBe('MATCH_FINISHED');
    expect(getMarketClosedReason(fin, 'Rezultati Pjesa e Dytë', NOW)).toBe('MATCH_FINISHED');
  });
});

describe('mapEventToMatch locks closed first-half markets', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  const raw = JSON.stringify({
    home_team: 'Alpha', away_team: 'Beta',
    bookmakers: [{ title: 'p', markets: [
      { key: 'm1', label: 'Rezultati Pjesa e Parë', category: 'main', outcomes: [{ name: '1', price: 2.1 }, { name: 'X', price: 2.0 }] },
      { key: 'm2', label: 'Rezultati Final', category: 'main', outcomes: [{ name: '1', price: 1.9 }, { name: 'X', price: 3.2 }] },
    ] }],
  });
  const row = (over) => ({ id: 'l365-1', league: 'x', home_team: 'Alpha', away_team: 'Beta', raw_json: raw, start_time: minutesAgo(52), status: 'LIVE', live_status: 'HT', live_minute: '45:00', ...over });

  it('at half-time the first-half market is suspended (UI shows it locked) and full-time stays open', () => {
    const m = mapEventToMatch(row());
    const h1 = m.markets.find((x) => x.name === 'Rezultati Pjesa e Parë');
    const ft = m.markets.find((x) => x.name === 'Rezultati Final');
    expect(h1.suspended).toBe(true);
    expect(h1.closedReason).toBe('FIRST_HALF_OVER');
    expect(h1.options.every((o) => o.suspended)).toBe(true);
    expect(ft.suspended).toBe(false);
    expect(ft.options.every((o) => !o.suspended)).toBe(true);
  });
  it('during the first half nothing is locked', () => {
    const m = mapEventToMatch(row({ start_time: minutesAgo(20), live_status: '1H', live_minute: '20:00' }));
    expect(m.markets.every((x) => !x.suspended)).toBe(true);
  });
});

// ---------------------------------------------------------------- settle from live score
describe('canSettleFromLiveScore', () => {
  const base = { live_home_score: 2, live_away_score: 1, live_minute: '90+', start_time: minutesAgo(110) };
  it('needs a real score AND a clock', () => {
    expect(canSettleFromLiveScore(base, NOW)).toBe(true);
    expect(canSettleFromLiveScore({ ...base, live_home_score: null }, NOW)).toBe(false);
    expect(canSettleFromLiveScore({ ...base, live_minute: null }, NOW)).toBe(false);
    expect(canSettleFromLiveScore(null, NOW)).toBe(false);
  });
  it('refuses a score from the middle of a match (feed dropped the game early)', () => {
    expect(canSettleFromLiveScore({ ...base, live_minute: '30:00', start_time: minutesAgo(35) }, NOW)).toBe(false);
  });
  it('accepts a late match by wall clock even if the last stored minute was lower', () => {
    expect(canSettleFromLiveScore({ ...base, live_minute: '86:00', start_time: minutesAgo(SETTLE_MIN_ELAPSED_MS / 60000 + 1) }, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------- settlement lifecycle (mock DB)
function seedMatch(over = {}) {
  mocks.matches.set('l365-1', {
    id: 'l365-1', status: 'FINISHED', start_time: minutesAgo(115), live_home_score: 2, live_away_score: 1,
    live_minute: '90+', result_home: null, result_away: null, settled_at: null, ht_home: 1, ht_away: 0, ...over,
  });
}
function seedBet(id, userId, stake, odds, leg) {
  mocks.bets.set(id, { id, user_id: userId, status: 'PENDING', stake, potential_return: Number((stake * odds).toFixed(2)) });
  if (!mocks.users.has(userId)) mocks.users.set(userId, { balance: 0 });
  mocks.legs.push({ id: mocks.legs.length + 1, bet_id: id, match_id: 'l365-1', match_home: 'Alpha', match_away: 'Beta', odds, status: 'PENDING', ...leg });
}
const h2hHome = { market_id: 'l365-1-h2h', market_name: '1X2 - Fituesi', selection_id: 'HOME', selection_name: 'Alpha' };
const h2hAway = { market_id: 'l365-1-h2h', market_name: '1X2 - Fituesi', selection_id: 'AWAY', selection_name: 'Beta' };

beforeEach(() => { mocks.reset(); });

describe('recoverFinishedWithoutResult (LIVE -> FINISHED by the socket, result never stored)', () => {
  it('settles the tickets from the real score: winners are paid, losers are not, match gets its result', async () => {
    seedMatch();
    seedBet('win', 'u1', 100, 2, h2hHome);
    seedBet('lose', 'u2', 50, 3, h2hAway);

    const r = await recoverFinishedWithoutResult({ now: NOW });

    expect(r).toMatchObject({ recoveredMatches: 1, recoverFailed: 0 });
    expect(mocks.bets.get('win').status).toBe('WON');
    expect(mocks.users.get('u1').balance).toBe(200);
    expect(mocks.bets.get('lose').status).toBe('LOST');
    expect(mocks.users.get('u2').balance).toBe(0);
    expect(mocks.matches.get('l365-1')).toMatchObject({ result_home: 2, result_away: 1 });
  });

  it('is idempotent: running the sweep again (or after a restart) never pays twice', async () => {
    seedMatch();
    seedBet('win', 'u1', 100, 2, h2hHome);
    await recoverFinishedWithoutResult({ now: NOW });
    await recoverFinishedWithoutResult({ now: NOW });
    await recoverFinishedWithoutResult({ now: NOW });
    expect(mocks.users.get('u1').balance).toBe(200);
  });

  it('two workers settling the same match at the same moment pay each bet once', async () => {
    seedMatch();
    seedBet('win', 'u1', 100, 2, h2hHome);
    seedBet('lose', 'u2', 50, 3, h2hAway);
    await Promise.all([
      recoverFinishedWithoutResult({ now: NOW }),
      recoverFinishedWithoutResult({ now: NOW }),
    ]);
    expect(mocks.users.get('u1').balance).toBe(200);
    expect(mocks.bets.get('win').status).toBe('WON');
    expect(mocks.bets.get('lose').status).toBe('LOST');
  });

  it('multiple bets from several users on the same match are each settled against their own balance', async () => {
    seedMatch();
    seedBet('a', 'u1', 10, 2, h2hHome);
    seedBet('b', 'u1', 20, 2, h2hHome);
    seedBet('c', 'u3', 30, 2, h2hHome);
    await recoverFinishedWithoutResult({ now: NOW });
    expect(mocks.users.get('u1').balance).toBe(20 + 40);
    expect(mocks.users.get('u3').balance).toBe(60);
  });

  it('does NOT settle on an unreliable result: the game left the feed mid-match, bets stay PENDING and nobody is paid', async () => {
    seedMatch({ live_minute: '30:00', start_time: minutesAgo(35) });
    seedBet('win', 'u1', 100, 2, h2hHome);
    const r = await recoverFinishedWithoutResult({ now: NOW });
    expect(r).toMatchObject({ recoveredMatches: 0, recoverNotYetReliable: 1 });
    expect(mocks.bets.get('win').status).toBe('PENDING');
    expect(mocks.users.get('u1').balance).toBe(0);
    expect(mocks.matches.get('l365-1').result_home).toBeNull();
  });

  it('final score arrives late: first pass leaves it pending, a later pass settles once the clock/time is reliable', async () => {
    seedMatch({ live_minute: '60:00', start_time: minutesAgo(70) });
    seedBet('win', 'u1', 100, 2, h2hHome);
    await recoverFinishedWithoutResult({ now: NOW });
    expect(mocks.bets.get('win').status).toBe('PENDING');
    // 40 minutes later the match is certainly over
    await recoverFinishedWithoutResult({ now: NOW + 40 * 60000 });
    expect(mocks.bets.get('win').status).toBe('WON');
    expect(mocks.users.get('u1').balance).toBe(200);
  });

  it('never invents a score: a finished match with no live score is left alone (postponed / never played)', async () => {
    seedMatch({ live_home_score: null, live_away_score: null, live_minute: null });
    seedBet('win', 'u1', 100, 2, h2hHome);
    const r = await recoverFinishedWithoutResult({ now: NOW });
    expect(r.recoverCandidates).toBe(0);
    expect(mocks.bets.get('win').status).toBe('PENDING');
    expect(mocks.users.get('u1').balance).toBe(0);
  });

  it('a temporary failure is reported and retried on the next sweep without double-paying', async () => {
    seedMatch();
    seedBet('win', 'u1', 100, 2, h2hHome);
    const realQuery = mocks.pool.connect;
    let fail = true;
    mocks.pool.connect = async () => {
      if (fail) { fail = false; throw new Error('connection reset'); }
      return realQuery();
    };
    try {
      const first = await recoverFinishedWithoutResult({ now: NOW });
      expect(first).toMatchObject({ recoveredMatches: 0, recoverFailed: 1 });
      expect(mocks.bets.get('win').status).toBe('PENDING');
      const second = await recoverFinishedWithoutResult({ now: NOW });
      expect(second).toMatchObject({ recoveredMatches: 1, recoverFailed: 0 });
      expect(mocks.users.get('u1').balance).toBe(200);
    } finally {
      mocks.pool.connect = realQuery;
    }
  });

  it('settles first-half and full-time legs of the same match from the right scores (HT 1-0, FT 2-1)', async () => {
    seedMatch();
    seedBet('h1', 'u1', 10, 2, { market_id: 'x', market_name: 'Rezultati Pjesa e Parë', selection_id: '1', selection_name: '1' });
    seedBet('h1-draw', 'u2', 10, 2, { market_id: 'x', market_name: 'Rezultati Pjesa e Parë', selection_id: 'X', selection_name: 'X' });
    seedBet('h2-home', 'u3', 10, 2, { market_id: 'x', market_name: 'Rezultati Pjesa e Dytë', selection_id: '1', selection_name: '1' });
    seedBet('h2-draw', 'u4', 10, 2, { market_id: 'x', market_name: 'Rezultati Pjesa e Dytë', selection_id: 'X', selection_name: 'X' });
    seedBet('ft-home', 'u5', 10, 2, h2hHome);
    await recoverFinishedWithoutResult({ now: NOW });
    expect(mocks.bets.get('h1').status).toBe('WON');        // 1-0 at the break
    expect(mocks.bets.get('h1-draw').status).toBe('LOST');
    expect(mocks.bets.get('h2-home').status).toBe('LOST');  // 2nd half = FT 2-1 minus HT 1-0 = 1-1, not the full-time score
    expect(mocks.bets.get('h2-draw').status).toBe('WON');
    expect(mocks.bets.get('ft-home').status).toBe('WON');   // full time 2-1
  });
});

describe('first-half tickets with the provider\'s real market names settle from the half-time score', () => {
  it.each(['Rezultati Pjesës së Parë', 'Rezultati Pjesa I'])('%s: HT 1-0, FT 2-0 -> backing "1" wins, "X" loses', async (name) => {
    seedMatch({ live_home_score: 2, live_away_score: 0, ht_home: 1, ht_away: 0 });
    seedBet('home', 'u1', 100, 1.76, { market_id: 'x', market_name: name, selection_id: '1', selection_name: '1' });
    seedBet('draw', 'u2', 100, 3, { market_id: 'x', market_name: name, selection_id: 'X', selection_name: 'X' });
    await recoverFinishedWithoutResult({ now: NOW });
    expect(mocks.bets.get('home').status).toBe('WON');
    expect(mocks.users.get('u1').balance).toBe(176);
    expect(mocks.bets.get('draw').status).toBe('LOST');
  });
  it('without a stored half-time score the first-half leg stays PENDING (never guessed)', async () => {
    seedMatch({ ht_home: null, ht_away: null });
    seedBet('home', 'u1', 100, 1.76, { market_id: 'x', market_name: 'Rezultati Pjesa I', selection_id: '1', selection_name: '1' });
    await recoverFinishedWithoutResult({ now: NOW });
    expect(mocks.bets.get('home').status).toBe('PENDING');
    expect(mocks.users.get('u1').balance).toBe(0);
  });
  it('a combo market (Rezultat Final & Numri i Golave) is not auto-settled', async () => {
    seedMatch();
    seedBet('combo', 'u1', 100, 7.91, { market_id: 'x', market_name: 'Rezultat Final & Numri i Golave në Ndeshje', selection_id: '1/0-1', selection_name: '1/0-1' });
    await recoverFinishedWithoutResult({ now: NOW });
    expect(mocks.bets.get('combo').status).toBe('PENDING');
  });
});

describe('settleMatch is not re-run once a match has its result', () => {
  it('returns null for an already settled match (duplicate full-time messages)', async () => {
    seedMatch({ result_home: 2, result_away: 1, settled_at: NOW });
    seedBet('win', 'u1', 100, 2, h2hHome);
    expect(await settleMatch('l365-1', 2, 1)).toBeNull();
    expect(mocks.bets.get('win').status).toBe('PENDING');
  });
});
