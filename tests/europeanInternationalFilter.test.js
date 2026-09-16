import { describe, it, expect } from 'vitest';
import { isEuropeanInternationalCompetition } from '../server/london365.js';

describe('isEuropeanInternationalCompetition - narrows the "International" bucket to actual European competitions', () => {
  it('allows UEFA competitions through', () => {
    expect(isEuropeanInternationalCompetition('UEFA Champions League')).toBe(true);
    expect(isEuropeanInternationalCompetition('UEFA Europa League')).toBe(true);
    expect(isEuropeanInternationalCompetition('UEFA Europa Conference League')).toBe(true);
    expect(isEuropeanInternationalCompetition('UEFA Nations League')).toBe(true);
    expect(isEuropeanInternationalCompetition('European Championship Qualifiers')).toBe(true);
  });

  it('allows the bare competition name (no UEFA prefix) since feeds vary', () => {
    expect(isEuropeanInternationalCompetition('Champions League')).toBe(true);
    expect(isEuropeanInternationalCompetition('Europa League')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isEuropeanInternationalCompetition('champions league')).toBe(true);
    expect(isEuropeanInternationalCompetition('CHAMPIONS LEAGUE')).toBe(true);
  });

  it('rejects South American club competitions (the exact reported case: Sao Paulo vs Boca Juniors)', () => {
    expect(isEuropeanInternationalCompetition('Copa Libertadores')).toBe(false);
    expect(isEuropeanInternationalCompetition('Copa Sudamericana')).toBe(false);
  });

  it('rejects OTHER confederations own "Champions League" competitions, not just UEFA', () => {
    expect(isEuropeanInternationalCompetition('AFC Champions League')).toBe(false);
    expect(isEuropeanInternationalCompetition('CAF Champions League')).toBe(false);
    expect(isEuropeanInternationalCompetition('CONCACAF Champions League')).toBe(false);
  });

  it('rejects other non-European continental/international competitions', () => {
    expect(isEuropeanInternationalCompetition('CONMEBOL World Cup Qualifiers')).toBe(false);
    expect(isEuropeanInternationalCompetition('Friendlies International')).toBe(false);
    expect(isEuropeanInternationalCompetition('World Cup')).toBe(false);
  });

  it('rejects empty/missing names safely', () => {
    expect(isEuropeanInternationalCompetition('')).toBe(false);
    expect(isEuropeanInternationalCompetition(null)).toBe(false);
    expect(isEuropeanInternationalCompetition(undefined)).toBe(false);
  });
});
