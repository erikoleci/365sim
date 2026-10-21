import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { teamKey } from '../utils/teamLogoKey.js';
import { resolveTeamLogo, __setTeamLogoIndexForTests } from '../utils/teamLogos.ts';

const DIR = path.join(process.cwd(), 'public', 'team-logos');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const file = (url) => (url ? url.replace(/^.*team-logos\//, '') : null);

beforeAll(() => __setTeamLogoIndexForTests(index));

describe('teamKey', () => {
  it('drops legal-form noise and diacritics but keeps what tells clubs apart', () => {
    expect(teamKey('Manchester United FC')).toBe('manchester united');
    expect(teamKey('1. FC Köln')).toBe('1 koln');
    expect(teamKey('Atlético Madrid')).toBe('atletico madrid');
    expect(teamKey('Borussia Dortmund U19')).toBe('borussia dortmund u19');
    expect(teamKey('FC')).toBe('fc');
  });
});

describe('resolveTeamLogo', () => {
  it('resolves common name variants of one club to the same crest', () => {
    const united = file(resolveTeamLogo('Manchester United'));
    expect(united).toMatch(/^england\/manchester-united\./);
    for (const alias of ['Man United', 'Man Utd', 'Manchester Utd', 'Manchester United FC']) expect(file(resolveTeamLogo(alias))).toBe(united);
    expect(file(resolveTeamLogo('Man City'))).toMatch(/manchester-city/);
  });
  it('does not merge different clubs', () => {
    expect(file(resolveTeamLogo('Manchester United'))).not.toBe(file(resolveTeamLogo('Manchester City')));
    expect(file(resolveTeamLogo('Real Madrid'))).not.toBe(file(resolveTeamLogo('Atletico Madrid')));
    expect(resolveTeamLogo('Sabah U19')).toBeNull();
    expect(resolveTeamLogo('Borussia Dortmund U19')).toBeNull();
    expect(resolveTeamLogo('Totally Unknown Club XYZ')).toBeNull();
    expect(resolveTeamLogo('')).toBeNull();
  });
  it('every resolved logo exists on disk', () => {
    for (const name of ['Arsenal', 'Real Madrid', 'Juventus', 'Bayern Munich', 'Paris Saint-Germain', 'Galatasaray']) {
      const f = file(resolveTeamLogo(name));
      expect(f, name).toBeTruthy();
      expect(fs.existsSync(path.join(DIR, f)), name).toBe(true);
    }
  });
  it('picks the league country when two countries share a club name', () => {
    const shared = Object.entries(index.byKey).find(([, files]) => new Set(files.map((f) => f.split('/')[0])).size > 1);
    if (!shared) return; // nothing ambiguous in this collection
    const [key, files] = shared;
    const wanted = files[files.length - 1];
    const countryLabel = { england: 'Anglia', spain: 'Spanja', italy: 'Italia', germany: 'Gjermania', france: 'Franca', portugal: 'Portugali', netherlands: 'Holandë', belgium: 'Belgjikë', turkey: 'Turqi', greece: 'Greqi', scotland: 'Skoci' }[wanted.split('/')[0]];
    if (countryLabel) expect(file(resolveTeamLogo(key, countryLabel))).toBe(wanted);
  });
});

// Verified coverage of the requested competitions (current top flights, names as feeds spell them).
const CLUBS = {
  'Premier League': ['Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford', 'Brighton', 'Chelsea', 'Crystal Palace', 'Everton', 'Fulham', 'Liverpool', 'Manchester City', 'Manchester United', 'Newcastle United', 'Nottingham Forest', 'Tottenham Hotspur', 'West Ham United', 'Wolverhampton Wanderers', 'Leeds United', 'Burnley'],
  'La Liga': ['Real Madrid', 'FC Barcelona', 'Atletico Madrid', 'Sevilla', 'Real Betis', 'Valencia', 'Villarreal', 'Real Sociedad', 'Athletic Bilbao', 'Girona', 'Celta Vigo', 'Osasuna', 'Getafe', 'Mallorca'],
  'Serie A': ['Juventus', 'AC Milan', 'Inter', 'Napoli', 'AS Roma', 'Lazio', 'Atalanta', 'Fiorentina', 'Bologna', 'Torino', 'Genoa', 'Udinese'],
  'Bundesliga': ['Bayern Munich', 'Borussia Dortmund', 'RB Leipzig', 'Bayer Leverkusen', 'Eintracht Frankfurt', 'VfB Stuttgart', 'Werder Bremen', 'VfL Wolfsburg', 'Borussia Monchengladbach', 'Freiburg', 'Augsburg'],
  'Ligue 1': ['Paris Saint-Germain', 'Marseille', 'Lyon', 'Monaco', 'Lille', 'Nice', 'Lens', 'Rennes', 'Strasbourg', 'Nantes'],
  'Other European': ['Ajax', 'PSV Eindhoven', 'Feyenoord', 'Benfica', 'FC Porto', 'Sporting CP', 'Galatasaray', 'Fenerbahce', 'Besiktas', 'Olympiacos', 'Panathinaikos', 'PAOK', 'Celtic', 'Rangers', 'Club Brugge', 'Anderlecht', 'Red Bull Salzburg', 'Shakhtar Donetsk', 'Dinamo Zagreb', 'Slavia Prague'],
};

describe('coverage of the requested competitions', () => {
  for (const [league, clubs] of Object.entries(CLUBS)) {
    it(`${league}: reports which clubs have a crest`, () => {
      const missing = clubs.filter((c) => !resolveTeamLogo(c));
      // Printed so a gap is visible, and an alias can be added in utils/teamLogos.ts.
      if (missing.length) console.log(`[logos] ${league} without crest: ${missing.join(', ')}`);
      expect(clubs.length - missing.length).toBeGreaterThanOrEqual(Math.ceil(clubs.length * 0.8));
    });
  }
});
