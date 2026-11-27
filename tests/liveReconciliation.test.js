import { describe, it, expect } from 'vitest';
import { shouldSettleMissingLiveMatch } from '../server/london365.js';

const NOW = Date.parse('2026-09-15T18:00:00Z');

describe('shouldSettleMissingLiveMatch - fast reconciliation after a server restart', () => {
  it('does NOT settle on a single miss with fresh fetched_at and recent kickoff (avoids acting on one transient feed gap)', () => {
    const result = shouldSettleMissingLiveMatch({
      consecutiveMisses: 1,
      fetchedAt: NOW - 10 * 1000,
      startTime: new Date(NOW - 30 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(result).toBe(false);
  });

  it('settles on the 2nd consecutive miss even with fresh fetched_at - this is what makes it fast right after boot', () => {
    const result = shouldSettleMissingLiveMatch({
      consecutiveMisses: 2,
      fetchedAt: NOW - 10 * 1000,
      startTime: new Date(NOW - 30 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(result).toBe(true);
  });

  it('settles once fetched_at is stale (8+ minutes), even on the very first miss', () => {
    const result = shouldSettleMissingLiveMatch({
      consecutiveMisses: 1,
      fetchedAt: NOW - 9 * 60 * 1000,
      startTime: new Date(NOW - 30 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(result).toBe(true);
  });

  it('settles once kickoff was 2.5+ hours ago, regardless of misses/fetchedAt (final safety net)', () => {
    const result = shouldSettleMissingLiveMatch({
      consecutiveMisses: 1,
      fetchedAt: NOW - 1000,
      startTime: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(result).toBe(true);
  });

  it('the exact restart scenario: match finished 3 minutes before a brief restart, fetched_at still looks recent', () => {
    const fetchedAt = NOW - 4 * 60 * 1000;
    const startTime = new Date(NOW - 50 * 60 * 1000).toISOString();
    expect(shouldSettleMissingLiveMatch({ consecutiveMisses: 1, fetchedAt, startTime, now: NOW })).toBe(false);
    expect(shouldSettleMissingLiveMatch({ consecutiveMisses: 2, fetchedAt, startTime, now: NOW })).toBe(true);
  });
});

import { vi } from 'vitest';
import { reviveWronglyClosedMatch } from '../server/london365.js';
describe('reviveWronglyClosedMatch - a game closed without a result that the provider lists live again', () => {
  const mk = (rows) => ({ query: vi.fn(async () => ({ rows })) });
  it('puts it back to LIVE, only for a FINISHED row without a final result, started under 3 h ago', async () => {
    const db = mk([{ id: 'l365-1' }]);
    expect(await reviveWronglyClosedMatch('l365-1', { minute: '45:00', score: { home: 0, away: 0 }, db })).toBe(true);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/status = 'FINISHED'/); expect(sql).toMatch(/result_home IS NULL AND result_away IS NULL/); expect(sql).toMatch(/INTERVAL '3 hours'/);
    expect(db.query.mock.calls[0][1]).toEqual(['l365-1']);
  });
  it('does nothing when the row is not eligible', async () => {
    expect(await reviveWronglyClosedMatch('l365-1', { minute: '45:00', score: { home: 0, away: 0 }, db: mk([]) })).toBe(false);
  });
  it('needs a real score and a clock from the provider before it even asks the database', async () => {
    const db = mk([{ id: 'x' }]);
    expect(await reviveWronglyClosedMatch('l365-1', { minute: null, score: { home: 0, away: 0 }, db })).toBe(false);
    expect(await reviveWronglyClosedMatch('l365-1', { minute: '45:00', score: null, db })).toBe(false);
    expect(await reviveWronglyClosedMatch('l365-1', { minute: '300:00', score: { home: 1, away: 0 }, db })).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });
});

import { hadLiveEvidence } from '../server/london365.js';
describe('hadLiveEvidence - a game with live events on record was playing, it is not closed as "never went live"', () => {
  const dbOf = (events, stats) => ({ query: vi.fn(async (sql) => ({ rows: /match_events/.test(sql) ? (events ? [{}] : []) : (stats ? [{}] : []) })) });
  it('is true with a logged event or live statistics, false with neither', async () => {
    expect(await hadLiveEvidence('l365-1', { db: dbOf(true, false) })).toBe(true);
    expect(await hadLiveEvidence('l365-1', { db: dbOf(false, true) })).toBe(true);
    expect(await hadLiveEvidence('l365-1', { db: dbOf(false, false) })).toBe(false);
  });
  it('answers "it was live" when the database cannot be asked (never closes on a guess)', async () => {
    expect(await hadLiveEvidence('l365-1', { db: { query: vi.fn(async () => { throw new Error('down'); }) } })).toBe(true);
  });
});
