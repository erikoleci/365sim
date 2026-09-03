/**
 * Generic adapter for an AUTHORIZED sports-data feed.
 *
 * This module deliberately does not bypass authentication, CAPTCHA, robots,
 * rate limits, WAFs, or other access controls. Configure it with an API/feed
 * that you are permitted to consume. The adapter accepts either a canonical
 * event payload or the flat market-row shape used by the user's supplied
 * example (id, odd, market_id, market, market_option, ...).
 */

const BASE_URL = (process.env.SOURCE_BASE_URL || '').replace(/\/$/, '');
const LEAGUES_URL = process.env.SOURCE_LEAGUES_URL || '';
const MATCHES_URL = process.env.SOURCE_MATCHES_URL || '';
const ODDS_TEMPLATE = process.env.SOURCE_MATCH_ODDS_URL_TEMPLATE || '';
const LIVE_TEMPLATE = process.env.SOURCE_MATCH_LIVE_URL_TEMPLATE || '';
const AUTH_TOKEN = process.env.SOURCE_AUTH_TOKEN || '';
const TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 10000);

function urlFrom(value, id) {
  if (!value) return '';
  const resolved = value.replaceAll('{id}', encodeURIComponent(String(id)));
  if (/^https?:\/\//i.test(resolved)) return resolved;
  if (!BASE_URL) return '';
  return `${BASE_URL}/${resolved.replace(/^\//, '')}`;
}

function headers() {
  const h = { Accept: 'application/json' };
  if (AUTH_TOKEN) h.Authorization = `Bearer ${AUTH_TOKEN}`;
  return h;
}

async function fetchJson(url) {
  if (!url) throw new Error('Source URL is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: headers(), signal: controller.signal });
    if (!resp.ok) throw new Error(`Source returned HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload.flat(Infinity).filter(Boolean);
  for (const key of ['data', 'results', 'matches', 'events', 'leagues', 'items']) {
    if (Array.isArray(payload?.[key])) return payload[key].flat(Infinity).filter(Boolean);
  }
  return [];
}

function first(obj, keys, fallback = null) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function normalizeFlatRows(rows, fallbackMatchId = null) {
  const groups = new Map();
  for (const row of rows) {
    const explicitId = first(row, ['match_id', 'matchId', 'event_id', 'eventId'], null);
    const compositeId = [first(row, ['home_team', 'homeTeam', 'home'], ''), first(row, ['away_team', 'awayTeam', 'away'], ''), first(row, ['game_date', 'start_time', 'startTime', 'commence_time'], '')].join('|');
    const matchId = String(explicitId ?? fallbackMatchId ?? compositeId);
    if (!matchId) continue;
    const current = groups.get(matchId) || {
      id: matchId,
      home_team: String(first(row, ['home_team', 'homeTeam', 'home'], '')),
      away_team: String(first(row, ['away_team', 'awayTeam', 'away'], '')),
      commence_time: first(row, ['game_date', 'start_time', 'startTime', 'commence_time'], new Date().toISOString()),
      league: String(first(row, ['league_name', 'league', 'competition'], 'Unknown League')),
      country: String(first(row, ['country_name', 'country'], '')),
      status: String(first(row, ['status', 'game_status'], 'UPCOMING')).toUpperCase(),
      source: 'authorized-feed',
      markets: [],
    };

    const marketId = String(first(row, ['market_id', 'marketId'], 'unknown'));
    let market = current.markets.find((m) => m.key === marketId);
    if (!market) {
      market = {
        key: marketId,
        name: String(first(row, ['market', 'market_name', 'marketName'], marketId)),
        category: String(first(row, ['mainCategory', 'category'], 'other')),
        options: [],
      };
      current.markets.push(market);
    }
    const optionId = String(first(row, ['market_option_id', 'selection_id', 'selectionId'], row.market_option ?? row.id));
    const odd = Number(first(row, ['odd', 'odds', 'price'], NaN));
    if (Number.isFinite(odd)) {
      market.options.push({
        id: optionId,
        name: String(first(row, ['market_option', 'selection_name', 'selectionName', 'name'], optionId)).trim(),
        odds: odd,
        point: row.special_value ?? row.point ?? null,
      });
    }
    groups.set(matchId, current);
  }
  return [...groups.values()];
}

function normalizeCanonicalEvent(event) {
  if (Array.isArray(event?.bookmakers)) {
    return {
      ...event,
      id: String(first(event, ['id', 'match_id', 'matchId', 'event_id', 'eventId'])),
      home_team: String(first(event, ['home_team', 'homeTeam', 'home'], '')),
      away_team: String(first(event, ['away_team', 'awayTeam', 'away'], '')),
      commence_time: first(event, ['commence_time', 'start_time', 'startTime', 'game_date'], new Date().toISOString()),
      league: String(first(event, ['league_name', 'league', 'competition'], 'Unknown League')),
      country: String(first(event, ['country_name', 'country'], '')),
      status: String(first(event, ['status', 'game_status'], 'UPCOMING')).toUpperCase(),
      source: event.source || 'authorized-feed',
      _sourceMeta: { ...(event._sourceMeta || {}), liveMinute: first(event, ['minute', 'currentMinute', 'live_minute'], event._sourceMeta?.liveMinute ?? null) },
    };
  }
  const markets = Array.isArray(event.markets) ? event.markets : [];
  return {
    id: String(first(event, ['id', 'match_id', 'matchId', 'event_id', 'eventId'])),
    home_team: String(first(event, ['home_team', 'homeTeam', 'home'], '')),
    away_team: String(first(event, ['away_team', 'awayTeam', 'away'], '')),
    commence_time: first(event, ['commence_time', 'start_time', 'startTime', 'game_date'], new Date().toISOString()),
    league: String(first(event, ['league_name', 'league', 'competition'], 'Unknown League')),
    country: String(first(event, ['country_name', 'country'], '')),
    status: String(first(event, ['status', 'game_status'], 'UPCOMING')).toUpperCase(),
    live_home_score: first(event, ['live_home_score', 'home_score', 'homeScore'], null),
    live_away_score: first(event, ['live_away_score', 'away_score', 'awayScore'], null),
    live_minute: first(event, ['minute', 'currentMinute', 'live_minute'], null),
    completed: Boolean(first(event, ['completed', 'is_finished', 'finished'], false)),
    bookmakers: [{
      title: 'Authorized Feed',
      markets: markets.map((m) => ({
        key: String(first(m, ['key', 'market_id', 'marketId'], 'unknown')),
        title: String(first(m, ['name', 'market', 'market_name'], 'Unknown Market')),
        outcomes: (m.options || m.outcomes || []).map((o) => ({
          name: String(first(o, ['name', 'market_option', 'selection_name'], '')),
          price: Number(first(o, ['price', 'odds', 'odd'], NaN)),
          point: o.point ?? o.special_value ?? undefined,
          sourceSelectionId: o.id ?? o.market_option_id,
        })).filter((o) => Number.isFinite(o.price)),
      })),
    }],
    _sourceMeta: {
      country: String(first(event, ['country_name', 'country'], '')),
      liveMinute: first(event, ['minute', 'currentMinute', 'live_minute'], null),
    },
  };
}

export function isConfigured() {
  return Boolean(MATCHES_URL || ODDS_TEMPLATE);
}

export function configurationStatus() {
  return {
    configured: isConfigured(),
    leagues: Boolean(LEAGUES_URL),
    matches: Boolean(MATCHES_URL),
    odds: Boolean(ODDS_TEMPLATE),
    live: Boolean(LIVE_TEMPLATE),
  };
}

export async function fetchLeagues() {
  if (!LEAGUES_URL) {
    const matches = await fetchMatches();
    const map = new Map();
    for (const m of matches) {
      const key = `${m.country || ''}:${m.league}`;
      if (!map.has(key)) map.set(key, { key: m.league, title: m.league, group: 'Soccer' });
    }
    return [...map.values()];
  }
  const payload = await fetchJson(urlFrom(LEAGUES_URL));
  return asArray(payload).map((l) => ({
    key: String(first(l, ['key', 'id', 'league_id', 'leagueId'], 'unknown')),
    title: String(first(l, ['title', 'name', 'league_name', 'leagueName'], 'Unknown League')),
    group: String(first(l, ['group', 'sport_name', 'sport'], 'Soccer')),
  }));
}

export async function fetchMatches() {
  if (!MATCHES_URL) return [];
  const payload = await fetchJson(urlFrom(MATCHES_URL));
  const rows = asArray(payload);
  const canonical = rows.filter((x) => Array.isArray(x?.markets) || Array.isArray(x?.bookmakers)).map(normalizeCanonicalEvent);
  const flat = rows.filter((x) => !Array.isArray(x?.markets) && !Array.isArray(x?.bookmakers));
  return [...canonical, ...normalizeFlatRows(flat)];
}

export async function fetchMatchOdds(matchId) {
  if (!ODDS_TEMPLATE) return null;
  const payload = await fetchJson(urlFrom(ODDS_TEMPLATE, matchId));
  const rows = asArray(payload);
  if (rows.some((x) => x?.market_id || x?.market || x?.odd)) {
    const events = normalizeFlatRows(rows, matchId);
    return events[0] ? normalizeCanonicalEvent(events[0]) : null;
  }
  const event = Array.isArray(payload) ? payload[0] : payload?.match || payload?.event || payload;
  return event ? normalizeCanonicalEvent(event) : null;
}

export async function fetchLive(matchId) {
  if (!LIVE_TEMPLATE) return null;
  const payload = await fetchJson(urlFrom(LIVE_TEMPLATE, matchId));
  const event = Array.isArray(payload) ? payload[0] : payload?.match || payload?.event || payload;
  if (!event) return null;
  return {
    status: String(first(event, ['status', 'game_status'], 'LIVE')).toUpperCase(),
    homeScore: Number(first(event, ['home_score', 'homeScore', 'live_home_score'], NaN)),
    awayScore: Number(first(event, ['away_score', 'awayScore', 'live_away_score'], NaN)),
    minute: first(event, ['minute', 'currentMinute', 'live_minute'], null),
    completed: Boolean(first(event, ['completed', 'finished', 'is_finished'], false)),
    events: Array.isArray(event.events) ? event.events : [],
    statistics: event.statistics || null,
  };
}

export function canonicalToRows(event) {
  return {
    ...event,
    raw_json: JSON.stringify(event),
  };
}
