import { describe, it, expect } from 'vitest';
import { getCancelBlockReason } from '../server/betValidation.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const min = (n) => n * 60 * 1000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const bet = (o = {}) => ({ status: 'PENDING', created_at: NOW - min(1), ...o });
const match = (o = {}) => ({ start_time: iso(min(60)), status: 'UPCOMING', live_status: null, ...o });
const opts = { now: NOW, windowMs: min(10) };

describe('getCancelBlockReason', () => {
  it('allows cancelling a fresh pre-match ticket', () => {
    expect(getCancelBlockReason(bet(), [match()], opts)).toBeNull();
  });
  it('blocks a ticket placed on a LIVE match', () => {
    const m = match({ start_time: iso(-min(30)), status: 'LIVE' });
    expect(getCancelBlockReason(bet(), [m], opts)).toMatch(/Live bets/);
  });
  it('blocks when kickoff had already passed at placement time, even if status lags', () => {
    const m = match({ start_time: iso(-min(5)), status: 'UPCOMING' });
    expect(getCancelBlockReason(bet(), [m], opts)).toMatch(/Live bets/);
  });
  it('blocks a pre-match ticket once the match has kicked off (no cancelling after a goal)', () => {
    const b = bet({ created_at: NOW - min(8) });
    const m = match({ start_time: iso(-min(1)), status: 'LIVE' });
    expect(getCancelBlockReason(b, [m], opts)).toMatch(/Live bets/);
  });
  it('blocks if the live feed marks the match as in-play', () => {
    expect(getCancelBlockReason(bet(), [match({ live_status: 'live' })], opts)).toMatch(/Live bets/);
  });
  it('accumulator: one live leg blocks the whole ticket', () => {
    const legs = [match(), match({ status: 'LIVE', start_time: iso(-min(20)) })];
    expect(getCancelBlockReason(bet(), legs, opts)).toMatch(/Live bets/);
  });
  it('still enforces status, window, and missing matches', () => {
    expect(getCancelBlockReason(bet({ status: 'WON' }), [match()], opts)).toMatch(/pending/);
    expect(getCancelBlockReason(bet({ created_at: NOW - min(11) }), [match()], opts)).toMatch(/window/);
    expect(getCancelBlockReason(bet(), [], opts)).not.toBeNull();
  });
});
