import { describe, it, expect } from 'vitest';
import { sameTeam, __sameTeamRaw, __resetPairMemoForTests } from '../server/fixtureDedupe.js';

const NAMES = ['Manchester City', 'Man City', 'Manchester United', 'Man Utd', 'Chelsea', 'Chelsea W', 'Koege', 'Koge', 'AGF Aarhus', 'Aarhus GF',
  'Sheffield Utd', 'Sheffield Wed', 'Inter', 'Inter Milan', 'Tottenham', 'Tottenham Hotspur', 'FC Koeln', '1. FC Koln', 'Real Madrid', 'Real Madrid U21', 'Norway', 'Wales', '', 'Kosovo', 'Israel'];

describe('sameTeam keeps the answers of sameTeamRaw while remembering them', () => {
  it('gives the same answer for every pair, the first time and every time after', () => {
    __resetPairMemoForTests();
    for (let round = 0; round < 3; round++) {
      for (const x of NAMES) for (const y of NAMES) expect(sameTeam(x, y)).toBe(__sameTeamRaw(x, y));
    }
  });
  it('stays right after the table starts over (more than 8192 different names)', () => {
    __resetPairMemoForTests();
    for (let i = 0; i < 8300; i++) sameTeam('Club ' + i, 'Team ' + i);
    for (const x of NAMES) for (const y of NAMES) expect(sameTeam(x, y)).toBe(__sameTeamRaw(x, y));
  });
});
