import { describe, it, expect } from 'vitest';
import { clubScore, matchWeight } from '../utils/topClubs';

describe('top clubs / match weight', () => {
  it('recognises elite and strong clubs, ignores the rest', () => {
    expect(clubScore('Real Madrid')).toBe(3);
    expect(clubScore('Manchester City')).toBe(3);
    expect(clubScore('Paris Saint-Germain')).toBe(3);
    expect(clubScore('Inter Milan')).toBe(3);
    expect(clubScore('Newcastle United')).toBe(2);
    expect(clubScore('Fulham FC')).toBe(0);
    expect(clubScore('Inter Miami')).toBe(0);
    expect(clubScore('')).toBe(0);
  });
  it('two strong clubs outweigh one strong club against a small one, even in a smaller league', () => {
    const derby = matchWeight('Real Madrid', 'FC Barcelona', 2);
    const lopsided = matchWeight('Manchester City', 'Fulham FC', 0);
    expect(derby).toBeGreaterThan(lopsided);
    expect(matchWeight('Benfica', 'FC Porto', 9)).toBeGreaterThan(matchWeight('Fulham FC', 'Ipswich Town', 0));
  });
});
