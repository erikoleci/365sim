import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- live detail planning --------------------------------------------------
import {
  selectDetailTargets, markDetailFetched, getLiveDetailAgeMs, pruneDetailAt, isLiveDetailStale, __resetDetailPlanForTests,
} from '../server/liveDetailPlan.js';

const games = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));

describe('selectDetailTargets (budgeted full-market refresh)', () => {
  beforeEach(() => __resetDetailPlanForTests());

  it('refreshes every game when there are fewer than the budget', () => {
    expect(selectDetailTargets(games(50), { budget: 120 }).size).toBe(50);
  });
  it('never exceeds the budget, however many games are live', () => {
    expect(selectDetailTargets(games(10000), { budget: 120 }).size).toBe(120);
  });
  it('games with an open bet / a viewer always come first', () => {
    const t = selectDetailTargets(games(1000), { budget: 10, priorityIds: new Set(['999', '998', '997']) });
    expect(t.has('999') && t.has('998') && t.has('997')).toBe(true);
    expect(t.size).toBe(10);
  });
  it('rotates: games refreshed longest ago go first, so every game is reached', () => {
    const all = games(300);
    const seen = new Set();
    for (let cycle = 0; cycle < 3; cycle++) {
      const targets = selectDetailTargets(all, { budget: 100 });
      for (const id of targets) { seen.add(id); markDetailFetched(id, 1000 + cycle); }
    }
    expect(seen.size).toBe(300); // 3 cycles x 100 covers all 300, none starved
  });
  it('never-refreshed games rank ahead of ones refreshed recently', () => {
    markDetailFetched('1', 5000);
    const t = selectDetailTargets(games(3), { budget: 2 });
    expect(t.has('1')).toBe(false);
  });
  it('prunes games that are no longer live', () => {
    markDetailFetched('1'); markDetailFetched('2');
    pruneDetailAt(new Set(['1']));
    expect(getLiveDetailAgeMs('2')).toBeNull();
    expect(getLiveDetailAgeMs('l365-1')).not.toBeNull();
  });
});

describe('isLiveDetailStale (stale odds guard for betting)', () => {
  it('fresh within the limit, stale beyond it', () => {
    expect(isLiveDetailStale({ ageMs: 30000, maxAgeMs: 120000, uptimeMs: 1e6 })).toBe(false);
    expect(isLiveDetailStale({ ageMs: 130000, maxAgeMs: 120000, uptimeMs: 1e6 })).toBe(true);
  });
  it('never refreshed: tolerated during the startup grace period, stale after it', () => {
    expect(isLiveDetailStale({ ageMs: null, maxAgeMs: 120000, uptimeMs: 60000 })).toBe(false);
    expect(isLiveDetailStale({ ageMs: null, maxAgeMs: 120000, uptimeMs: 600000 })).toBe(true);
  });
  it('is off when the limit is 0', () => {
    expect(isLiveDetailStale({ ageMs: 1e9, maxAgeMs: 0, uptimeMs: 1e9 })).toBe(false);
  });
});

// ---- websocket coalescing + backpressure -----------------------------------
vi.mock('../server/routes/auth.js', () => ({ JWT_SECRET: 'test' }));
const ws = await import('../server/ws.js');

function fakeSocket(buffered = 0) {
  return { OPEN: 1, readyState: 1, bufferedAmount: buffered, sent: [], send(m) { this.sent.push(JSON.parse(m)); } };
}

describe('live tick coalescing', () => {
  beforeEach(() => { vi.useFakeTimers(); ws.__resetWsForTests(); });
  afterEach(() => { vi.useRealTimers(); });

  it('10,000 live matches become 50 batched frames, not 10,000 messages per client', () => {
    const client = fakeSocket();
    ws.__subscribeForTests('live', client);
    for (let i = 0; i < 10000; i++) ws.pushLiveTick('m' + i, { homeScore: 0, awayScore: 0, minute: '10:00' });
    expect(client.sent.length).toBe(0); // nothing yet: coalescing window
    vi.advanceTimersByTime(300);
    expect(client.sent.length).toBe(50);
    expect(client.sent.every((f) => f.type === 'LIVE_TICKS' && f.ticks.length === 200)).toBe(true);
    expect(client.sent.reduce((n, f) => n + f.ticks.length, 0)).toBe(10000);
  });
  it('only the newest tick of a match survives inside one window', () => {
    const client = fakeSocket();
    ws.__subscribeForTests('live', client);
    ws.pushLiveTick('m1', { homeScore: 0, awayScore: 0 });
    ws.pushLiveTick('m1', { homeScore: 1, awayScore: 0 });
    vi.advanceTimersByTime(300);
    expect(client.sent[0].ticks).toHaveLength(1);
    expect(client.sent[0].ticks[0].homeScore).toBe(1);
  });
  it('a client viewing one match still gets its ticks immediately', () => {
    const viewer = fakeSocket();
    ws.__subscribeForTests('match:m1', viewer);
    ws.pushLiveTick('m1', { homeScore: 2, awayScore: 1 });
    expect(viewer.sent[0]).toMatchObject({ type: 'LIVE_TICK', homeScore: 2 });
  });
  it('a client with a huge outgoing backlog is skipped for ticks (but not for goals)', () => {
    const slow = fakeSocket(5 * 1024 * 1024);
    ws.__subscribeForTests('live', slow);
    ws.pushLiveTick('m1', { homeScore: 0 });
    vi.advanceTimersByTime(300);
    expect(slow.sent).toHaveLength(0);
    ws.pushGoal('m1', { homeScore: 1, awayScore: 0 });
    expect(slow.sent[0]).toMatchObject({ type: 'GOAL' });
  });
  it('reports which matches clients are watching', () => {
    ws.__subscribeForTests('match:l365-42', fakeSocket());
    ws.__subscribeForTests('live', fakeSocket());
    expect(ws.getWatchedMatchIds()).toEqual(['42']);
  });
});
