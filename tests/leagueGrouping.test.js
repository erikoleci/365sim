import { describe, it, expect } from 'vitest';
import { leagueCountry, leagueCountryToken, countryFlag } from '../utils/leagueGrouping.ts';

describe('leagueCountry - classifies by COMPETITION identity, never by team', () => {
  it('Real Madrid in the Champions League groups under Ndërkombëtare, NOT Spanja', () => {
    // This is the exact scenario reported as a concern: a Spanish team
    // playing a European competition must not be grouped under its own
    // country just because of who's playing.
    expect(leagueCountry('l365_international__uefa-champions-league')).toBe('Ndërkombëtare');
    expect(leagueCountry('UEFA Champions League')).toBe('Ndërkombëtare');
  });

  it('a provider league key encoded with the real country slug groups correctly', () => {
    expect(leagueCountry('l365_spain__la-liga')).toBe('Spanja');
    expect(leagueCountry('l365_italy__serie-a')).toBe('Italia');
    expect(leagueCountry('l365_england__premier-league')).toBe('Anglia');
    expect(leagueCountry('l365_germany__bundesliga')).toBe('Gjermania');
  });

  it('classifies readable league names with no country in the slug (e.g. "Serie A") by the name itself', () => {
    expect(leagueCountry('Serie A')).toBe('Italia');
    expect(leagueCountry('Premier League')).toBe('Anglia');
    expect(leagueCountry('Bundesliga')).toBe('Gjermania');
  });

  it('Europa League and Conference League are also Ndërkombëtare, not tied to any single country', () => {
    expect(leagueCountry('UEFA Europa League')).toBe('Ndërkombëtare');
    expect(leagueCountry('UEFA Europa Conference League')).toBe('Ndërkombëtare');
  });

  it('a Brazilian regional competition (no "Brazil" in the name) still resolves via the name-token map', () => {
    expect(leagueCountry('Amazonense Serie B')).toBe('Brazil');
    expect(leagueCountry('Campeonato Brasileiro Serie A')).toBe('Brazil');
  });

  it('an unrecognized league falls back to "Të tjera", not a crash or a wrong country', () => {
    // No underscore (so the slug-parsing shortcuts don't fire) and no word
    // in the name-token dictionary.
    expect(leagueCountry('zzqqxxnonsenseleaguename')).toBe('Të tjera');
  });

  it('an unknown-but-real country token (not yet in the Albanian label dictionary) still gets its own name, not "Të tjera"', () => {
    // New LondonPro365-style key with a country slug we have no Albanian
    // label for -- should title-case the slug, not dump it in "Të tjera"
    // (which would make it indistinguishable from genuinely unclassifiable
    // leagues).
    expect(leagueCountry('l365_atlantis__atlantis-cup')).toBe('Atlantis');
  });
});

describe('leagueCountryToken - raw token resolution', () => {
  it('prefers the double-underscore provider format over name-based guessing', () => {
    expect(leagueCountryToken('l365_costa-rica__primera-division')).toBe('costa-rica');
  });

  it('returns null for a key it cannot classify at all', () => {
    expect(leagueCountryToken('zzqqxxnonsenseleaguename')).toBeNull();
  });
});

describe('countryFlag', () => {
  it('gives a globe for Ndërkombëtare and a white flag for Të tjera, never a wrong country flag', () => {
    expect(countryFlag('Ndërkombëtare')).toBe('🌍');
    expect(countryFlag('Të tjera')).toBe('🏳️');
  });

  it('gives the correct flag emoji for a real country label', () => {
    expect(countryFlag('Spanja')).toBe('🇪🇸');
    expect(countryFlag('Italia')).toBe('🇮🇹');
  });
});
