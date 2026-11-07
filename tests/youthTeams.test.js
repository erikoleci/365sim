import { describe, it, expect } from 'vitest';
import { isYouthTeam, isAllowedByCountryFilter, MINOR_LEAGUE_PATTERN } from '../server/london365/leagueRules.js';

describe('youth sides are not offered (the feed never scores them)', () => {
  it('recognises youth team names in several languages', () => {
    for (const n of ['Jeugd Royal Francs Borains', 'Jeugd Sporting Hasselt', 'Bayern Jugend', 'Lyon Jeunes', 'Milan Primavera', 'Betis Juvenil', 'Ajax U19', 'Chelsea U-21', 'Spurs Youth', 'Naegohyang Womens FC', 'Barcelona Femenino', 'Bayern Frauen', 'Arsenal (W)']) expect(isYouthTeam(n), n).toBe(true);
  });
  it('does not touch ordinary clubs', () => {
    for (const n of ['KV RS Waasland Beveren', 'RFC Seraing', 'SK Artis Brno B', 'Manchester United', 'Young Boys', 'Juventus', 'Womenswear United FC']) expect(isYouthTeam(n), n).toBe(false);
  });
  it('a game with a youth side is dropped by the live filter', () => {
    expect(isAllowedByCountryFilter({ league: 'Belgium Something', home_team: 'Jeugd Royal Francs Borains', away_team: 'Jeugd Sporting Hasselt' }, null)).toBe(false);
  });
  it('league names with Dutch/German youth words are minor', () => {
    expect(MINOR_LEAGUE_PATTERN.test('Belgium Jeugd Competitie')).toBe(true);
  });
});
