import { describe, it, expect } from 'vitest';
import { sideOrderFromEvents } from '../server/matchSettlement.js';

const ev = (...teams) => teams.map((team, i) => ({ team, created_at: 1000 + i * 10 }));

describe('sideOrderFromEvents (first / last corner or card)', () => {
  it('a complete log decides first and last', () => {
    expect(sideOrderFromEvents(ev('home', 'away', 'away'), 1, 2)).toEqual({ first: 'HOME', last: 'AWAY' });
  });
  it('no events at all means nobody did it', () => {
    expect(sideOrderFromEvents([], 0, 0)).toEqual({ first: 'NONE', last: 'NONE' });
  });
  it('more logged events than the counters is never trusted', () => {
    expect(sideOrderFromEvents(ev('home', 'home', 'away'), 1, 1)).toBeUndefined();
  });
  it('a missing HOME corner does not change the last corner when the last logged one is HOME (Supra v Cavalry: 5-3, log 4-3)', () => {
    const log = ev('away', 'home', 'home', 'away', 'home', 'away', 'home');
    expect(sideOrderFromEvents(log, 5, 3)).toEqual({ first: undefined, last: 'HOME' });
  });
  it('but if the last logged corner is AWAY, a missing HOME one could have come after it', () => {
    const log = ev('home', 'home', 'home', 'home', 'away', 'away', 'away');
    expect(sideOrderFromEvents(log, 5, 3)).toEqual({ first: 'HOME', last: undefined });
  });
  it('when the other side had none, every corner was the missing side', () => {
    expect(sideOrderFromEvents(ev('home'), 3, 0)).toEqual({ first: 'HOME', last: 'HOME' });
    expect(sideOrderFromEvents([], 2, 0)).toEqual({ first: 'HOME', last: 'HOME' });
  });
  it('events missing on both sides stay undecided', () => {
    expect(sideOrderFromEvents(ev('home', 'away'), 3, 3)).toBeUndefined();
  });
  it('an event tied in time with the other side stays undecided', () => {
    const log = [{ team: 'home', created_at: 5 }, { team: 'away', created_at: 5 }];
    expect(sideOrderFromEvents(log, 2, 1)).toEqual({ first: undefined, last: undefined });
  });
});
