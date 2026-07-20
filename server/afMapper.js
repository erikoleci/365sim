// Converts API-Football's fixture + odds JSON into the same internal shape
// the rest of the app already understands (bets.js, matchSettlement.js,
// oddsUtils' sortOptions convention) so nothing downstream needed to change.

// API-Football fixture.status.short codes -> our internal status.
// https://www.api-football.com/documentation-v3 (Fixtures -> status codes)
const LIVE_CODES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const FINISHED_CODES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

export function mapFixtureStatus(shortCode) {
  if (FINISHED_CODES.has(shortCode)) return 'FINISHED';
  if (LIVE_CODES.has(shortCode)) return 'LIVE';
  return 'UPCOMING'; // NS, TBD, PST, CANC, etc.
}

// Bet market names vary slightly by bookmaker/locale in API-Football's
// response, so match loosely (lowercased, punctuation-insensitive) rather
// than on one exact string. Unrecognized bet names are skipped, not crashed
// on — logged once so real traffic surfaces anything we didn't anticipate.
const seenUnknownBetNames = new Set();
function normalizeBetName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function classifyBet(betName) {
  const n = normalizeBetName(betName);
  if (n === 'match winner' || n === '1x2') return 'h2h';
  if (n.includes('goals over under') || n === 'over under') return 'totals';
  if (n.includes('both teams score') || n === 'btts') return 'btts';
  if (n.includes('asian handicap')) return 'spreads';
  if (!seenUnknownBetNames.has(betName)) {
    seenUnknownBetNames.add(betName);
    console.log(`[api-football] Skipping unrecognized bet market: "${betName}"`);
  }
  return null;
}

const MARKET_LABELS = {
  h2h: { name: '1X2', category: 'Kryesore' },
  totals: { name: 'Over/Under Gola', category: 'Gola' },
  btts: { name: 'Të Dyja Skuadrat Shënojnë', category: 'Gola' },
  spreads: { name: 'Hendikep Aziatik', category: 'Hendikep' },
};

function classifyOutcome(marketKey, value, homeTeamName) {
  if (marketKey === 'h2h') {
    if (value === 'Home') return { id: 'HOME', name: homeTeamName };
    if (value === 'Away') return { id: 'AWAY', name: null }; // name filled by caller (away team)
    if (value === 'Draw') return { id: 'DRAW', name: 'Barazim' };
    return null;
  }
  if (marketKey === 'totals') {
    const m = /^(Over|Under)\s+([\d.]+)$/i.exec(value);
    if (!m) return null;
    const side = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const point = parseFloat(m[2]);
    return { id: `${side}-${point}`, name: `${side === 'Over' ? 'Mbi' : 'Nën'} ${point}`, point };
  }
  if (marketKey === 'btts') {
    if (value === 'Yes') return { id: 'Yes', name: 'Po' };
    if (value === 'No') return { id: 'No', name: 'Jo' };
    return null;
  }
  if (marketKey === 'spreads') {
    // e.g. value = "Home -1.5" — keep as-is for display, point used for sort only
    const m = /(-?[\d.]+)\s*$/.exec(value);
    const point = m ? parseFloat(m[1]) : 0;
    return { id: `${value}`, name: value, point };
  }
  return null;
}

// Fixed rendering order per market — same convention as the previous
// The-Odds-API integration (1/X/2 always left-to-right, Over before Under).
function sortOptions(marketKey, options) {
  if (marketKey === 'h2h') {
    const order = { HOME: 0, DRAW: 1, AWAY: 2 };
    return [...options].sort((a, b) => (order[a.id] ?? 99) - (order[b.id] ?? 99));
  }
  if (marketKey === 'totals' || marketKey === 'spreads') {
    return [...options].sort((a, b) => (a.point ?? 0) - (b.point ?? 0));
  }
  return options;
}

// Builds the `markets` array for one fixture from its cached odds bookmakers
// list. Picks the FIRST bookmaker present (API-Football returns a fixed,
// curated bookmaker list per fixture) for a single consistent set of prices.
export function buildMarkets(fixtureId, homeTeam, awayTeam, bookmakers) {
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return [];
  const bookmaker = bookmakers[0];
  const marketMap = new Map(); // marketKey -> Map(optionId -> option)

  for (const bet of bookmaker.bets || []) {
    const marketKey = classifyBet(bet.name);
    if (!marketKey) continue;
    if (!marketMap.has(marketKey)) marketMap.set(marketKey, new Map());
    const outMap = marketMap.get(marketKey);

    for (const v of bet.values || []) {
      const outcome = classifyOutcome(marketKey, v.value, homeTeam);
      if (!outcome) continue;
      const name = outcome.id === 'AWAY' ? awayTeam : outcome.name;
      outMap.set(outcome.id, {
        id: outcome.id,
        name,
        odds: parseFloat(v.odd),
        bookmaker: bookmaker.name,
        point: outcome.point,
      });
    }
  }

  return Array.from(marketMap.entries()).map(([key, outMap]) => ({
    id: `${fixtureId}-${key}`,
    marketKey: key,
    name: MARKET_LABELS[key].name,
    category: MARKET_LABELS[key].category,
    options: sortOptions(key, Array.from(outMap.values())),
  }));
}

// row = a matches_cache row whose raw_json is JSON.stringify({ fixture, bookmakers })
export function afMapRowToMatch(row) {
  const parsed = JSON.parse(row.raw_json);
  const markets = buildMarkets(row.id, row.home_team, row.away_team, parsed.bookmakers);

  return {
    id: row.id,
    league: row.league,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    startTime: row.start_time,
    status: row.status,
    markets,
    bookmakerCount: Array.isArray(parsed.bookmakers) ? parsed.bookmakers.length : 0,
    liveHomeScore: row.live_home_score ?? undefined,
    liveAwayScore: row.live_away_score ?? undefined,
    score: row.status === 'FINISHED' && row.result_home !== null && row.result_away !== null
      ? { home: row.result_home, away: row.result_away, htHome: 0, htAway: 0, homeYellowCards: 0, awayYellowCards: 0, homeCorners: 0, awayCorners: 0, scorers: [] }
      : undefined,
  };
}

// Used by bets.js to re-verify a selection's price server-side before
// accepting a bet, same contract resolveCurrentOdds() had before.
export function afResolveCurrentOdds(row, marketId, selectionId) {
  const parsed = JSON.parse(row.raw_json);
  const markets = buildMarkets(row.id, row.home_team, row.away_team, parsed.bookmakers);
  const market = markets.find((m) => m.id === marketId);
  if (!market) return null;
  const option = market.options.find((o) => o.id === selectionId);
  return option ? option.odds : null;
}
