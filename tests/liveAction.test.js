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
