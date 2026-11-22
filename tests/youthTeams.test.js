import { describe, it, expect } from 'vitest';
import { isYouthTeam, isWomenTeam, isAllowedByCountryFilter, MINOR_LEAGUE_PATTERN } from '../server/london365/leagueRules.js';

describe('youth sides are not offered (the feed never scores them)', () => {
  it('recognises youth team names in several languages', () => {
    for (const n of ['Jeugd Royal Francs Borains', 'Jeugd Sporting Hasselt', 'Bayern Jugend', 'Lyon Jeunes', 'Milan Primavera', 'Betis Juvenil', 'Ajax U19', 'Chelsea U-21', 'Spurs Youth', 'Spurs U-21']) expect(isYouthTeam(n), n).toBe(true);
  });
  it('women\'s sides are offered by default, and named with (W) like the provider', () => {
    for (const n of ['Lazio (W)', 'Juventus (W)', 'Naegohyang Womens FC', 'Barcelona Femenino', 'Bayern Frauen']) expect(isYouthTeam(n), n).toBe(false);
    for (const n of ['Lazio (W)', 'Naegohyang Womens FC', 'Barcelona Femenino', 'Bayern Frauen']) expect(isWomenTeam(n), n).toBe(true);
    expect(isAllowedByCountryFilter({ league: 'Italy Serie A Women', home_team: 'Lazio (W)', away_team: 'Juventus (W)' }, null)).toBe(true);
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
