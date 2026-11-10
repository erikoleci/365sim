// How "big" a match is, so the home page's "Ndeshjet Kryesore" shows the real headliners (two strong clubs, a
// European night) instead of always the same league. A plain, readable list: tweak it when a club rises or falls.
const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// 3 = the elite clubs everybody tunes in for, 2 = strong clubs.
const ELITE: RegExp[] = [
  /^real madrid/, /^(fc )?barcelona/, /^manchester city/, /^liverpool/, /^arsenal/, /^(fc )?bayern/, /^paris saint germain|^psg$/,
  /^(fc )?inter(nazionale)?( milan)?$/, /^juventus/, /^(ac )?milan$/, /^manchester united/, /^chelsea/, /^tottenham/,
  /^atletico madrid|^club atletico de madrid/, /^borussia dortmund/, /^(ssc )?napoli/,
];
const STRONG: RegExp[] = [
  /^(bayer )?(04 )?leverkusen|^bayer 04/, /^newcastle/, /^aston villa/, /^(as )?roma$/, /^(ss )?lazio/, /^atalanta/, /^sevilla/,
  /^villarreal/, /^real sociedad/, /^athletic (club|bilbao)/, /^real betis/, /^(sl )?benfica/, /^(fc )?porto/, /^sporting (cp|lisbon|lisboa)/,
  /^ajax/, /^psv/, /^feyenoord/, /^(olympique )?marseille/, /^(as )?monaco/, /^(olympique )?lyon/, /^lille/, /^rb leipzig|^leipzig/,
  /^west ham/, /^fiorentina/, /^celtic/, /^galatasaray/, /^fenerbahce/, /^besiktas/, /^brighton/, /^crystal palace/, /^eintracht/,
];

export const clubScore = (team: string): number => {
  const name = norm(team);
  if (!name) return 0;
  if (ELITE.some((r) => r.test(name))) return 3;
  if (STRONG.some((r) => r.test(name))) return 2;
  return 0;
};

/** Higher = a bigger match. Two strong clubs beat one; a top competition adds a little on top. */
export const matchWeight = (home: string, away: string, leagueRank: number): number => {
  const h = clubScore(home);
  const a = clubScore(away);
  const clubs = h + a + (h > 0 && a > 0 ? 3 : 0); // both sides strong: a real headline
  const competition = leagueRank <= 4 ? 2 : leagueRank <= 7 ? 2.5 : 0; // big five / UEFA cups
  return clubs + competition;
};
