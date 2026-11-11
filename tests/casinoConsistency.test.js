import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

// What the screen shows, what the server draws, what the player is paid and what the round history records must be the same
// numbers. Real routes, real engines, in-memory wallet.
const mocks = vi.hoisted(() => {
  const state = { users: new Map(), kv: new Map(), rounds: [], open: new Map() };
  const reset = (balance = 1_000_000) => {
    state.users.clear(); state.kv.clear(); state.rounds = []; state.open.clear();
    state.users.set('p1', { id: 'p1', username: 'p1', role: 'USER', is_active: true, balance, balance_eur: 0, account_currency: 'BOTH' });
    state.kv.set('casino_access', 'all');
  };
  reset();
  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim(); const u = state.users.get('p1');
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.startsWith('SELECT id, role, is_active FROM users')) return { rows: [u] };
    if (s.startsWith('SELECT account_currency FROM users')) return { rows: [{ account_currency: u.account_currency }] };
    if (/^SELECT balance( AS bal)? FROM users WHERE id = \$1( FOR UPDATE)?$/.test(s)) return { rows: [{ balance: u.balance, bal: u.balance }] };
    if (s.startsWith('SELECT balance, balance_eur FROM users')) return { rows: [{ balance: u.balance, balance_eur: u.balance_eur }] };
    if (s.startsWith('SELECT balance_eur AS bal')) return { rows: [{ bal: u.balance_eur }] };
    if (s === 'UPDATE users SET balance = balance - $1 WHERE id = $2') { u.balance = Math.round((u.balance - params[0]) * 100) / 100; return { rows: [] }; }
    if (s === 'UPDATE users SET balance = balance + $1 WHERE id = $2') { u.balance = Math.round((u.balance + params[0]) * 100) / 100; return { rows: [] }; }
    if (s.startsWith('UPDATE users SET balance = balance - $1 + $2 WHERE id = $3')) { u.balance = Math.round((u.balance - params[0] + params[1]) * 100) / 100; return { rows: [{ balance: u.balance }] }; }
    // multi-step rounds (blackjack, video poker, mines): rows are kept so the routes can load and close them
    if (s.startsWith('SELECT * FROM casino_rounds WHERE id = $1')) { await new Promise((r) => setTimeout(r, 2)); const r = state.open.get(params[0]); return { rows: r ? [{ ...r }] : [] }; }
    if (s.includes("'blackjack',$3,$4,$5,$6,$7,$8,$9")) { state.open.set(params[0], { id: params[0], user_id: 'p1', game: 'blackjack', stake: params[2], status: params[3], state: params[4], payout: params[5] }); return { rows: [] }; }
    if (s.includes("'videopoker',$3,'PLAYING'")) { state.open.set(params[0], { id: params[0], user_id: 'p1', game: 'videopoker', stake: params[2], status: 'PLAYING', state: params[3], payout: 0 }); return { rows: [] }; }
    if (s.includes("'mines',$3,'PLAYING'")) { state.open.set(params[0], { id: params[0], user_id: 'p1', game: 'mines', stake: params[2], status: 'PLAYING', state: params[3], payout: 0 }); return { rows: [] }; }
    if (s.startsWith('UPDATE casino_rounds SET')) {
      await new Promise((r) => setTimeout(r, 4)); // all simultaneous requests have loaded the round before the first one writes
      const idParam = s.includes('SET status = $1') ? params[5] : s.includes("SET status='FINISHED', state=$1") ? params[4] : s.includes("SET status='FINISHED', payout=$1") ? params[3] : params[1];
      const r = state.open.get(idParam); if (!r) return { rows: [], rowCount: 0 };
      if (s.includes("status = 'PLAYING'") || s.includes("status='PLAYING'")) { if (r.status !== 'PLAYING') return { rows: [], rowCount: 0 }; }
      if (s.startsWith('UPDATE casino_rounds SET status = $1, state = $2, payout = $3')) { r.status = params[0]; r.state = params[1]; r.payout = params[2]; }
      else if (s.includes("SET status='FINISHED', state=$1, payout=$2")) { r.status = 'FINISHED'; r.state = params[0]; r.payout = params[1]; }
      else if (s.includes("SET status='FINISHED', payout=$1")) { r.status = 'FINISHED'; r.payout = params[0]; }
      else if (s.includes("SET status='FINISHED', payout=0")) { r.status = 'FINISHED'; r.payout = 0; }
      else if (s.startsWith('UPDATE casino_rounds SET state = $1')) r.state = params[0];
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO casino_rounds')) {
      if (s.includes('free_spins')) state.rounds.push({ game: params[2], stake: Number(params[4]), payout: Number(params[5]) });
      else if (s.includes("'FINISHED',NULL,$5,$6,$7")) state.rounds.push({ game: params[2], stake: Number(params[3]), payout: Number(params[5]), result: JSON.parse(params[4]) });
      else if (s.includes("'FINISHED',$5,$6,$7,$8,$8")) state.rounds.push({ game: params[2], stake: Number(params[3]), payout: Number(params[5]) });
      else state.rounds.push({ game: params[2], stake: Number(params[3]), payout: 0, other: true });
      return { rows: [] };
    }
    if (s.startsWith('SELECT value FROM kv_store WHERE key = $1')) return { rows: state.kv.has(params[0]) ? [{ value: state.kv.get(params[0]) }] : [] };
    if (s.startsWith('INSERT INTO kv_store')) { state.kv.set(params[0], params[1]); return { rows: [] }; }
    throw new Error('unmocked query: ' + s);
  }
  const pool = { query, connect: async () => ({ query, release() {} }) };
  return { state, reset, pool };
});
vi.mock('../server/db.js', () => ({ default: mocks.pool, pool: mocks.pool }));

const { JWT_SECRET } = await import('../server/routes/auth.js');
const casinoRouter = (await import('../server/routes/casino.js')).default;
const { clearProfileCache } = await import('../server/casinoProfiles.js');
const token = jwt.sign({ id: 'p1', username: 'p1', role: 'USER' }, JWT_SECRET, { expiresIn: '1h' });
let server; let baseUrl;
const setProfile = (key, values) => { const ov = JSON.parse(mocks.state.kv.get('casino_profiles') || '{}'); ov[key] = values; mocks.state.kv.set('casino_profiles', JSON.stringify(ov)); clearProfileCache(); };
const call = async (method, path, body) => {
  const r = await fetch(`${baseUrl}/api/casino${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const balance = () => mocks.state.users.get('p1').balance;
const cents = (x) => Math.round(x * 100) / 100;
beforeEach(async () => {
  mocks.reset(); clearProfileCache();
  const app = express(); app.use(express.json()); app.use('/api/casino', casinoRouter);
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });
const base = { minBet: 1, maxBet: 5000 };

// Plays `n` rounds; every one must move the balance by exactly (payout - stake) and be recorded with the same payout.
async function play(n, path, bodyOf, check) {
  for (let i = 0; i < n; i += 1) {
    const before = balance(); const logged = mocks.state.rounds.length;
    const { status, body } = await call('POST', path, bodyOf(i));
    expect(status, JSON.stringify(body)).toBe(200);
    const stake = bodyOf(i).stake;
    expect(cents(balance() - before), 'wallet moved by payout - stake').toBe(cents(body.payout - stake));
    expect(mocks.state.rounds.length, 'one history row per round').toBe(logged + 1);
    expect(mocks.state.rounds.at(-1).payout, 'history = paid').toBe(body.payout);
    expect(mocks.state.rounds.at(-1).stake).toBe(stake);
    check?.(body, stake);
  }
}

describe('wheel: shown segments = drawn segment = payout = history (with a low max win)', () => {
  it('every spin lands on a shown segment value and pays exactly stake x that value', async () => {
    setProfile('wheel', { ...base, hitFrequency: 0.4, rtp: 0.6, volatility: 5, maxWinMultiplier: 3 });
    const { body: seg } = await call('GET', '/wheel/segments');
    expect(Math.max(...seg.segments)).toBeLessThanOrEqual(3);
    await play(150, '/wheel/spin', () => ({ stake: 7 }), (b, stake) => {
      expect(seg.segments[b.index]).toBe(b.multiplier);
      expect(b.payout).toBe(cents(stake * b.multiplier));
    });
  });
});

describe('scratch: printed prizes = multiplier = payout (cap reaches the printed cells)', () => {
  it('a win shows three equal prizes worth exactly what is paid; a loss shows none', async () => {
    setProfile('scratch', { ...base, hitFrequency: 0.5, rtp: 0.8, volatility: 5, maxWinMultiplier: 4 });
    await play(150, '/scratch/play', () => ({ stake: 10 }), (b, stake) => {
      expect(b.payout).toBe(cents(stake * b.multiplier));
      expect(b.multiplier).toBeLessThanOrEqual(4);
      if (b.multiplier > 0) expect(b.cells.filter((c) => c === b.multiplier).length).toBeGreaterThanOrEqual(3);
      else expect(b.payout).toBe(0);
    });
  });
});

describe('video slot: the spins that are animated add up to what is paid (also when the cap cuts the round)', () => {
  it('hot-fruits with max win 4x', async () => {
    setProfile('slot:hot-fruits', { ...base, hitFrequency: 0.5, rtp: 0.8, volatility: 5, maxWinMultiplier: 4 });
    await play(250, '/slot-games/hot-fruits/spin', () => ({ stake: 10, currency: 'ALL' }), (b, stake) => {
      expect(b.payout).toBeLessThanOrEqual(stake * 4 + 1e-9);
      const sum = b.spins.reduce((a, sp) => a + sp.win, 0);
      expect(Math.abs(sum - b.payout), `spins ${sum} vs paid ${b.payout}`).toBeLessThan(0.0101);
      expect(b.freeSpins).toBe(b.spins.length - 1);
    });
  });
  it('sugar cascade (tumble) with max win 4x', async () => {
    setProfile('tumble', { ...base, hitFrequency: 0.5, rtp: 0.8, volatility: 5, maxWinMultiplier: 4 });
    await play(120, '/tumble/spin', () => ({ stake: 10, currency: 'ALL' }), (b, stake) => {
      expect(b.payout).toBeLessThanOrEqual(stake * 4 + 1e-9);
      const sum = b.spins.reduce((a, sp) => a + sp.win + sp.scatterWin, 0);
      expect(Math.abs(sum - b.payout), `spins ${sum} vs paid ${b.payout}`).toBeLessThan(0.0101 * b.spins.length);
    });
  });
});

describe('hold & win: coins shown add up to the paid multiplier unless the full-board bonus is in', () => {
  it('payout = stake x multiplier, never above the cap', async () => {
    setProfile('holdwin', { ...base, hitFrequency: 0.5, rtp: 0.8, volatility: 5, maxWinMultiplier: 5 });
    await play(150, '/holdwin/play', () => ({ stake: 10 }), (b, stake) => {
      expect(b.payout).toBe(cents(stake * b.multiplier)); expect(b.multiplier).toBeLessThanOrEqual(5);
    });
  });
});

describe('dice and cups: the multiplier that is returned is the one that is paid, at the configured RTP', () => {
  it('cups at RTP 50%: pays stake x (2.85 x 0.5/0.95) on a win', async () => {
    setProfile('cups', { ...base, rtp: 0.5 });
    const expected = cents(2.85 * (0.5 / 0.95));
    let wins = 0;
    await play(120, '/cups/play', () => ({ stake: 10, cup: 1 }), (b, stake) => {
      expect(b.multiplier).toBe(expected);
      if (b.won) { wins += 1; expect(b.payout).toBe(cents(stake * expected)); } else expect(b.payout).toBe(0);
    });
    expect(wins).toBeGreaterThan(10); expect(wins).toBeLessThan(80);
  });
  it('dice at RTP 47.5% (half of 95%): a win pays half of the usual 2.28 / 5.7 table', async () => {
    setProfile('dice', { ...base, rtp: 0.475 });
    await play(120, '/dice/roll', () => ({ stake: 10, selectedBet: 'SEVEN' }), (b, stake) => {
      if (b.result === 'SEVEN') expect(b.payout).toBe(cents(stake * 5.7 * 0.5)); else expect(b.payout).toBe(0);
    });
  });
});

describe('dog and horse race (single): the odds shown = the odds paid', () => {
  for (const [name, path, key, field] of [['dogs', '/dogs', 'dogs', 'dogs'], ['horses', '/horses', 'horses', 'horses']]) {
    it(`${name}: a win pays stake x the odds of the runner as shown for this race, at the configured RTP`, async () => {
      setProfile(key, { ...base, rtp: 0.5 });
      for (let i = 0; i < 80; i += 1) {
        const info = (await call('GET', `${path}/info`)).body; const runners = info[field];
        for (const r of runners) expect(r.p * r.odds).toBeLessThanOrEqual(0.5 + 1e-9);
        const pick = i % 6; const before = balance(); const logged = mocks.state.rounds.length;
        const { body } = await call('POST', `${path}/race`, { stake: 10, [name === 'dogs' ? 'dog' : 'horse']: pick, token: info.token });
        expect(body.odds).toBe(runners[pick].odds);
        expect(body.payout).toBe(body.order[0] === pick ? cents(10 * runners[pick].odds) : 0);
        expect(cents(balance() - before)).toBe(cents(body.payout - 10));
        expect(mocks.state.rounds.length).toBe(logged + 1); expect(mocks.state.rounds.at(-1).payout).toBe(body.payout);
      }
    });
  }
});

describe('super slots: shown multiplier = paid, history = paid', () => {
  it('payout = stake x multiplier, never above the cap', async () => {
    setProfile('slots', { ...base, hitFrequency: 0.5, rtp: 0.8, volatility: 5, maxWinMultiplier: 6 });
    await play(150, '/slots/spin', () => ({ stake: 10, game: 'fruit' }), (b, stake) => {
      expect(b.multiplier).toBeLessThanOrEqual(6); expect(Math.abs(b.payout - stake * b.multiplier)).toBeLessThan(0.0101);
    });
  });
});

describe('limits and balances', () => {
  it('bets outside the game profile are refused before any money moves; roulette totals count', async () => {
    setProfile('plinko', { minBet: 10, maxBet: 20, rtp: 0.6 });
    setProfile('roulette', { minBet: 5, maxBet: 50 });
    const before = balance();
    expect((await call('POST', '/plinko/drop', { stake: 5, risk: 'LOW', rows: 8 })).status).toBe(400);
    expect((await call('POST', '/plinko/drop', { stake: 25, risk: 'LOW', rows: 8 })).status).toBe(400);
    expect((await call('POST', '/roulette/spin', { bets: { RED: 30, BLACK: 30 } })).status).toBe(400);
    expect((await call('POST', '/roulette/spin', { bets: { RED: 2, BLACK: 2 } })).status).toBe(400);
    expect(balance()).toBe(before); expect(mocks.state.rounds).toHaveLength(0);
    expect((await call('POST', '/plinko/drop', { stake: 10, risk: 'LOW', rows: 8 })).status).toBe(200);
    expect((await call('POST', '/roulette/spin', { bets: { RED: 20, BLACK: 20 } })).status).toBe(200);
  });
  it('a player who cannot cover the stake is refused and loses nothing', async () => {
    mocks.reset(3);
    const r = await call('POST', '/wheel/spin', { stake: 10 });
    expect(r.status).toBe(400); expect(balance()).toBe(3); expect(mocks.state.rounds).toHaveLength(0);
  });
  it('invalid stakes (negative, zero, NaN-like, string) never reach the wallet', async () => {
    const before = balance();
    for (const stake of [-5, 0, '10', null, 1e9]) expect((await call('POST', '/wheel/spin', { stake })).status).toBe(400);
    expect(balance()).toBe(before);
  });
});

describe('simultaneous requests can never pay a round twice', () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  it('blackjack: ten "stand" requests at once pay exactly once', async () => {
    let roundId = null;
    for (let i = 0; i < 30 && !roundId; i += 1) {
      const { body } = await call('POST', '/blackjack/deal', { stake: 10 });
      if (body.roundId && body.status !== 'FINISHED') roundId = body.roundId; // skip rounds that ended on a natural
    }
    expect(roundId).toBeTruthy();
    const before = balance();
    const results = await Promise.all(Array.from({ length: 10 }, () => call('POST', `/blackjack/${roundId}/stand`)));
    const done = results.filter((r) => r.status === 200);
    expect(done).toHaveLength(1);
    const payout = done[0].body.payout;
    expect(cents(balance() - before)).toBe(cents(payout)); // the stake was taken at the deal; exactly one payout since
    expect(mocks.state.open.get(roundId).payout).toBe(payout);
    await sleep(1);
  });
  it('video poker: ten "draw" requests at once pay exactly once', async () => {
    const { body } = await call('POST', '/videopoker/deal', { stake: 10 });
    const before = balance();
    const results = await Promise.all(Array.from({ length: 10 }, () => call('POST', `/videopoker/${body.roundId}/draw`, { holdIndices: [0, 1, 2, 3, 4] })));
    const done = results.filter((r) => r.status === 200);
    expect(done).toHaveLength(1);
    expect(cents(balance() - before)).toBe(cents(done[0].body.payout));
  });
  it('mines: a cash-out and a second cash-out at once pay exactly once', async () => {
    const { body } = await call('POST', '/mines/start', { stake: 10, mines: 1 });
    const state = JSON.parse(mocks.state.open.get(body.roundId).state);
    const safe = [...Array(25).keys()].find((i) => !state.mines.includes(i));
    expect((await call('POST', `/mines/${body.roundId}/reveal`, { index: safe })).status).toBe(200);
    const before = balance();
    const results = await Promise.all(Array.from({ length: 8 }, () => call('POST', `/mines/${body.roundId}/cashout`)));
    const done = results.filter((r) => r.status === 200);
    expect(done).toHaveLength(1);
    expect(cents(balance() - before)).toBe(cents(done[0].body.payout));
  });
});
