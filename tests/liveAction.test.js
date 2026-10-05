import { describe, it, expect } from 'vitest';
import { decodeLiveAction } from '../server/liveAction.js';

// The seven VC values below are the owner's hand-labelled captures
// (Hapoel Tel Aviv v Hapoel Haifa).
describe('decodeLiveAction', () => {
  it.each([
    ['21002', 'away', 'possession'],
    ['21007', 'away', 'back_line_restart'],
    ['11004', 'home', 'corner'],
    ['11000', 'home', 'dangerous_attack'],
    ['11234', 'home', 'offside'],
    ['21001', 'away', 'attack'],
    ['21000', 'away', 'dangerous_attack'],
  ])('%s -> %s %s', (vc, side, kind) => {
    expect(decodeLiveAction(vc)).toMatchObject({ side, kind });
  });

  it('returns null for unknown or malformed codes (never guesses)', () => {
    expect(decodeLiveAction('21010')).toBeNull();
    expect(decodeLiveAction('21025')).toBeNull();
    expect(decodeLiveAction('')).toBeNull();
    expect(decodeLiveAction(undefined)).toBeNull();
    expect(decodeLiveAction('abc')).toBeNull();
    expect(decodeLiveAction('31000')).toBeNull();
  });
});

describe('decodeLiveAction half time', () => {
  // Capture labelled "pushim" (end of first half) by the owner: Odd 2 v Viking 2, T=2700, SC=2-1.
  it('decodes VC=1015 as the half-time break with no side', () => {
    expect(decodeLiveAction('1015')).toEqual({ side: null, kind: 'half_time', label: 'Pushim' });
  });

  it('never attributes the break to a team, even if a team digit is present', () => {
    expect(decodeLiveAction('11015')).toMatchObject({ side: null, kind: 'half_time' });
    expect(decodeLiveAction('21015')).toMatchObject({ side: null, kind: 'half_time' });
  });
});

describe('decodeLiveAction 4-digit codes', () => {
  it('decodes VC=1007 (rivene fundore) with an unknown side', () => {
    expect(decodeLiveAction('1007')).toMatchObject({ side: null, kind: 'back_line_restart' });
    expect(decodeLiveAction('1999')).toBeNull();
  });
});
