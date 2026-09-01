export const MARKET_LABELS = {
  h2h: { name: '1X2 - Fituesi', category: 'main' },
  totals: { name: 'Totali i Golave', category: 'goals' },
  btts: { name: 'Të dy Skuadrat Shënojnë', category: 'goals' },
  double_chance: { name: 'Shans i Dyfishtë', category: 'main' },
  draw_no_bet: { name: 'Barazimi = Rimbursim', category: 'main' },
  spreads: { name: 'Hendikep Asian', category: 'handicap' },
};

function getMarketMeta(key, rawName = '') {
  if (MARKET_LABELS[key]) return MARKET_LABELS[key];
  return { name: rawName || key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), category: 'other' };
}

export function outcomeId(marketKey, outcome, ev) {
  const raw = String(outcome.name ?? '');
  if (marketKey === 'h2h' || marketKey === 'double_chance' || marketKey === 'draw_no_bet') {
    if (raw === ev.home_team) return 'HOME';
    if (raw === ev.away_team) return 'AWAY';
    if (/^draw$/i.test(raw) || /^x$/i.test(raw)) return 'DRAW';
    return outcome.sourceSelectionId ? String(outcome.sourceSelectionId) : raw.replace(/\s+/g, '_');
  }
  if (outcome.point !== undefined && outcome.point !== null && outcome.point !== '') return `${raw}-${outcome.point}`;
  return outcome.sourceSelectionId ? String(outcome.sourceSelectionId) : raw;
}

function translateOutcomeName(marketKey, id, outcome, ev) {
  if (marketKey === 'h2h') {
    if (id === 'HOME') return ev.home_team;
    if (id === 'AWAY') return ev.away_team;
    if (id === 'DRAW') return 'Barazim';
  }
  if (marketKey === 'totals') {
    const side = /^over$/i.test(outcome.name) ? 'Mbi' : /^under$/i.test(outcome.name) ? 'Nën' : outcome.name;
    return outcome.point != null ? `${side} ${outcome.point}` : side;
  }
  if (marketKey === 'btts') {
    if (/^yes$/i.test(outcome.name)) return 'Po';
    if (/^no$/i.test(outcome.name)) return 'Jo';
  }
  return outcome.point != null ? `${outcome.name} ${outcome.point}` : outcome.name;
}

export function diffOddsChanges(matchId, oldEv, newEv) {
  function bestPrices(ev) {
    const best = new Map();
    for (const bookmaker of ev?.bookmakers || []) {
      for (const market of bookmaker.markets || []) {
        const marketKey = String(market.key);
        if (!best.has(marketKey)) best.set(marketKey, new Map());
        const outMap = best.get(marketKey);
        for (const outcome of market.outcomes || []) {
          const id = outcomeId(marketKey, outcome, ev);
          const price = Number(outcome.price);
          if (!Number.isFinite(price)) continue;
          const existing = outMap.get(id);
          if (!existing || price > existing.price) outMap.set(id, { price });
        }
      }
    }
    return best;
  }
  const oldBest = bestPrices(oldEv);
  const newBest = bestPrices(newEv);
  const changes = [];
  for (const [marketKey, outMap] of newBest.entries()) {
    for (const [selectionId, data] of outMap.entries()) {
      const oldPrice = oldBest.get(marketKey)?.get(selectionId)?.price ?? null;
      if (oldPrice !== null && Math.abs(oldPrice - data.price) < 0.001) continue;
      changes.push({ matchId, marketId: `${matchId}-${marketKey}`, selectionId, oldOdds: oldPrice, newOdds: data.price });
    }
  }
  return changes;
}

export function mapEventToMatch(row) {
  const ev = typeof row.raw_json === 'string' ? JSON.parse(row.raw_json) : row.raw_json;
  const marketMap = new Map();
  for (const bookmaker of ev.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      const key = String(market.key);
      if (!marketMap.has(key)) marketMap.set(key, { name: market.title || market.name || '', options: new Map() });
      const entry = marketMap.get(key);
      for (const outcome of market.outcomes || []) {
        const id = outcomeId(key, outcome, ev);
        const odds = Number(outcome.price);
        if (!Number.isFinite(odds)) continue;
        const existing = entry.options.get(id);
        if (!existing || odds > existing.odds) {
          entry.options.set(id, { id, name: translateOutcomeName(key, id, outcome, ev), odds, bookmaker: bookmaker.title, point: outcome.point });
        }
      }
    }
  }
  const markets = [...marketMap.entries()].map(([key, entry]) => {
    const meta = getMarketMeta(key, entry.name);
    return { id: `${row.id}-${key}`, marketKey: key, name: meta.name, category: meta.category, options: [...entry.options.values()] };
  });
  return {
    id: String(row.id),
    league: row.league,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    startTime: row.start_time,
    status: row.status,
    markets,
    bookmakerCount: ev.bookmakers?.length || 0,
    liveHomeScore: row.live_home_score ?? undefined,
    liveAwayScore: row.live_away_score ?? undefined,
    currentMinute: ev._sourceMeta?.liveMinute ?? row.live_minute ?? undefined,
    score: row.status === 'FINISHED' && row.result_home != null && row.result_away != null
      ? { home: row.result_home, away: row.result_away, htHome: 0, htAway: 0, homeYellowCards: 0, awayYellowCards: 0, homeCorners: 0, awayCorners: 0, scorers: [] }
      : undefined,
  };
}

export function resolveCurrentOdds(row, marketId, selectionId) {
  const match = mapEventToMatch(row);
  const market = match.markets.find((m) => m.id === marketId);
  if (!market) return null;
  const option = market.options.find((o) => o.id === selectionId);
  return option ? option.odds : null;
}
