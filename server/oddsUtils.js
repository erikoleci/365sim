// Shared logic for turning a raw The Odds API event into our Match/Market
// shape, and for resolving a single (marketKey, selectionId) back to its
// current best price. Used by both routes/matches.js (listing) and
// routes/bets.js (server-side verification at bet placement time).
//
// IMPORTANT: `id` fields (marketId, selectionId) are always kept in their
// original English/API-derived form (HOME/AWAY/DRAW, "Over-2.5", etc.) —
// these are internal keys used for settlement matching in routes/admin.js
// and must never change. Only the human-facing `name` fields are
// translated to Albanian. Never parse business logic out of `name`.

export const MARKET_LABELS = {
  h2h: { name: '1X2 - Fituesi', category: 'main' },
  totals: { name: 'Totali i Golave', category: 'goals' },
  btts: { name: 'Të dy Skuadrat Shënojnë', category: 'goals' },
  double_chance: { name: 'Shans i Dyfishtë', category: 'main' },
  draw_no_bet: { name: 'Barazimi = Rimbursim', category: 'main' },
  spreads: { name: 'Hendikep Asian', category: 'handicap' },
};

export function outcomeId(marketKey, outcome, ev) {
  if (marketKey === 'h2h' || marketKey === 'double_chance' || marketKey === 'draw_no_bet') {
    if (outcome.name === ev.home_team) return 'HOME';
    if (outcome.name === ev.away_team) return 'AWAY';
    if (outcome.name === 'Draw') return 'DRAW';
    return outcome.name.replace(/\s+/g, '_');
  }
  if (outcome.point !== undefined) return `${outcome.name}-${outcome.point}`;
  return outcome.name;
}

// Translate a raw API outcome into its Albanian display label.
// `id` is the stable outcomeId already computed above — we branch on that
// (not on raw English strings) so this stays correct even if the API's
// wording changes slightly between bookmakers.
function translateOutcomeName(marketKey, id, outcome, ev) {
  if (marketKey === 'h2h') {
    if (id === 'HOME') return ev.home_team;
    if (id === 'AWAY') return ev.away_team;
    if (id === 'DRAW') return 'Barazim';
    return outcome.name;
  }

  if (marketKey === 'totals') {
    const side = outcome.name === 'Over' ? 'Mbi' : outcome.name === 'Under' ? 'Nën' : outcome.name;
    return `${side} ${outcome.point}`;
  }

  if (marketKey === 'btts') {
    if (outcome.name === 'Yes') return 'Po';
    if (outcome.name === 'No') return 'Jo';
    return outcome.name;
  }

  if (marketKey === 'draw_no_bet') {
    if (id === 'HOME') return ev.home_team;
    if (id === 'AWAY') return ev.away_team;
    return outcome.name;
  }

  if (marketKey === 'double_chance') {
    // Best-effort phrase translation: swap in team names / "Barazim" for
    // whichever tokens the bookmaker's outcome name contains. Falls back
    // to the raw API text if nothing recognizable is found.
    const raw = outcome.name;
    const hasHome = raw.includes(ev.home_team);
    const hasAway = raw.includes(ev.away_team);
    const hasDraw = /draw/i.test(raw);
    if (hasHome && hasDraw) return `${ev.home_team} ose Barazim`;
    if (hasAway && hasDraw) return `${ev.away_team} ose Barazim`;
    if (hasHome && hasAway) return `${ev.home_team} ose ${ev.away_team}`;
    return raw;
  }

  if (marketKey === 'spreads') {
    const team = outcome.name === ev.home_team ? ev.home_team : outcome.name === ev.away_team ? ev.away_team : outcome.name;
    const point = outcome.point > 0 ? `+${outcome.point}` : outcome.point;
    return `${team} (${point})`;
  }

  return outcome.point !== undefined ? `${outcome.name} ${outcome.point}` : outcome.name;
}

// Merge every bookmaker's view into one market per key, keeping the BEST
// (highest) price per outcome across bookmakers.
export function mapEventToMatch(row) {
  const ev = JSON.parse(row.raw_json);
  const marketMap = new Map();

  for (const bookmaker of ev.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (!MARKET_LABELS[market.key]) continue;
      if (!marketMap.has(market.key)) marketMap.set(market.key, new Map());
      const outMap = marketMap.get(market.key);
      for (const outcome of market.outcomes || []) {
        const id = outcomeId(market.key, outcome, ev);
        const existing = outMap.get(id);
        if (!existing || outcome.price > existing.odds) {
          outMap.set(id, {
            id,
            name: translateOutcomeName(market.key, id, outcome, ev),
            odds: outcome.price,
            bookmaker: bookmaker.title,
          });
        }
      }
    }
  }

  const markets = Array.from(marketMap.entries()).map(([key, outMap]) => ({
    id: `${row.id}-${key}`,
    marketKey: key,
    name: MARKET_LABELS[key].name,
    category: MARKET_LABELS[key].category,
    options: Array.from(outMap.values()),
  }));

  return {
    id: row.id,
    league: row.league,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    startTime: row.start_time,
    status: row.status,
    markets,
    bookmakerCount: (ev.bookmakers || []).length,
  };
}

// Look up the current BEST price for a specific marketId + selectionId
// against a raw cached event row. Returns null if not found (e.g. market
// closed, odds moved off the board, bad client data).
export function resolveCurrentOdds(row, marketId, selectionId) {
  const match = mapEventToMatch(row);
  const market = match.markets.find((m) => m.id === marketId);
  if (!market) return null;
  const option = market.options.find((o) => o.id === selectionId);
  return option ? option.odds : null;
}
