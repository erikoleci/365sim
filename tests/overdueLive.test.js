import { describe, it, expect } from 'vitest';
import { isOverdueLive } from '../server/london365/liveSync.js';

const NOW = Date.parse('2026-11-06T20:00:00Z');
const row = (o) => ({ status: 'LIVE', start_time: new Date(NOW - o.k * 60000).toISOString(), live_home_score: o.h ?? null, live_away_score: o.a ?? null, live_minute: o.m ?? null, live_minute_updated_at: o.u ?? null });

describe('isOverdueLive: a match the feed still lists as live but that must be over', () => {
  it('a normal live match is never overdue', () => {
    expect(isOverdueLive(row({ k: 60, h: 1, a: 0, m: '55', u: NOW - 20000 }), NOW)).toBe(false);
    expect(isOverdueLive(row({ k: 100, h: 1, a: 1, m: '88', u: NOW - 20000 }), NOW)).toBe(false);
  });
  it('score AND clock, 3 h after kickoff: overdue (as before)', () => {
    expect(isOverdueLive(row({ k: 185, h: 1, a: 0, m: '90', u: NOW - 60000 }), NOW)).toBe(true);
  });
  it('score without any clock (small league / youth game) 3 h after kickoff: overdue, so its tickets close', () => {
    expect(isOverdueLive(row({ k: 135, h: 2, a: 1 }), NOW)).toBe(true);
    expect(isOverdueLive(row({ k: 110, h: 2, a: 1 }), NOW)).toBe(false); // too early to trust
  });
  it('no usable result at all: only after 4 h, then it is closed without settling', () => {
    expect(isOverdueLive(row({ k: 140 }), NOW)).toBe(false);
    expect(isOverdueLive(row({ k: 155 }), NOW)).toBe(true);
  });
  it('a frozen clock projected past full time is overdue', () => {
    expect(isOverdueLive(row({ k: 120, h: 0, a: 0, m: '61', u: NOW - 35 * 60000 }), NOW)).toBe(true);
  });
  it('an unknown row is not overdue', () => {
    expect(isOverdueLive(null, NOW)).toBe(false);
  });
});
