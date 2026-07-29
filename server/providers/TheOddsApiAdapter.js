// server/providers/TheOddsApiAdapter.js
//
// Adapter for The Odds API (api.the-odds-api.com), wrapping the existing
// fetch/cache/credit-budget logic that used to live inline in
// routes/matches.js. Implements the OddsProvider interface so the rest of
// the app never touches The Odds API's response shape directly.
//
// To add a new provider (Sportradar, API-Football, SportsDataIO, a custom
// feed, etc.): create AnotherAdapter.js implementing the same three
// methods (listMatches, getMatch, refreshOdds), register it in
// registry.js, and nothing else in the codebase changes.

import { OddsProvider } from './OddsProvider.js';
import pool, { getKV, setKV } from '../db.js';
import { mapEventToMatch } from '../oddsUtils.js';

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const MARKETS = 'h2h,totals,spreads';
const LEAGUES_REFRESH_MS = 24 * 60 * 60 * 1000;
const ODDS_REFRESH_MS = 96 * 60 * 60 * 1000;
const MIN_REMAINING_CREDITS_BUFFER = 20;

const TOP_LEAGUES = [
  'soccer_epl', 'soccer_uefa_champs_league', 'soccer_spain_la_liga',
  'soccer_fifa_world_cup', 'soccer_usa_mls', 'soccer_italy_serie_a',
  'soccer_germany_bundesliga', 'soccer_france_ligue_one', 'soccer_brazil_campeonato',
];
const TOP_LEAGUE_KEYWORDS = ['world cup', 'champions league'];

function isTopLeague(l) {
  if (TOP_LEAGUES.includes(l.key)) return true;
  const title = (l.title || '').toLowerCase();
  return TOP_LEAGUE_KEYWORDS.some((kw) => title.includes(kw));
}

export class TheOddsApiAdapter extends OddsProvider {
  constructor() {
    super();
    this.name = 'the-odds-api';
    this._leaguesCache = { data: [], fetchedAt: 0 };
    this._oddsRefreshTimers = new Map();
    this._lastKnownRemaining = Infinity;
    this._loaded = false;
  }

  async _ensureStateLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    this._leaguesCache = await getKV('leaguesCache', { data: [], fetchedAt: 0 });
    this._oddsRefreshTimers = new Map(Object.entries(await getKV('oddsRefreshTimers', {})));
    this._lastKnownRemaining = await getKV('lastKnownRemaining', Infinity);
  }

  async _fetchJson(url) {
    await this._ensureStateLoaded();
    const resp = await fetch(url);
    const remaining = resp.headers.get('x-requests-remaining');
    if (remaining !== null) {
      this._lastKnownRemaining = Number(remaining);
      await setKV('lastKnownRemaining', this._lastKnownRemaining);
    }
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Odds API ${resp.status}: ${body}`);
    }
    return resp.json();
  }

  async _getSoccerLeagues() {
    await this._ensureStateLoaded();
    const now = Date.now();
    if (this._leaguesCache.data.length && now - this._leaguesCache.fetchedAt < LEAGUES_REFRESH_MS) {
      return this._leaguesCache.data;
    }
    if (!ODDS_API_KEY) return [];
    const all = await this._fetchJson(`${ODDS_API_BASE}/sports/?apiKey=${ODDS_API_KEY}`);
    const soccer = all.filter((s) => s.group === 'Soccer' && s.active);
    this._leaguesCache = { data: soccer, fetchedAt: now };
    await setKV('leaguesCache', this._leaguesCache);
    return soccer;
  }

  async _refreshLeagueOdds(leagueKey) {
    await this._ensureStateLoaded();
    const now = Date.now();
    const last = this._oddsRefreshTimers.get(leagueKey) || 0;
    if (now - last < ODDS_REFRESH_MS) return;
    if (this._lastKnownRemaining <= MIN_REMAINING_CREDITS_BUFFER) return;
    this._oddsRefreshTimers.set(leagueKey, now);
    await setKV('oddsRefreshTimers', Object.fromEntries(this._oddsRefreshTimers));

    const url = `${ODDS_API_BASE}/sports/${leagueKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=${MARKETS}&oddsFormat=decimal`;
    let events;
    try {
      events = await this._fetchJson(url);
    } catch (err) {
      console.error(`[the-odds-api] Failed refreshing odds for ${leagueKey}:`, err.message);
      return;
    }
    for (const ev of events) {
      const status = new Date(ev.commence_time) > new Date() ? 'UPCOMING' : 'LIVE';
      await pool.query(
        `INSERT INTO matches_cache (id, league, home_team, away_team, start_time, status, raw_json, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           status = CASE WHEN matches_cache.status = 'FINISHED' THEN matches_cache.status ELSE excluded.status END,
           raw_json = excluded.raw_json, fetched_at = excluded.fetched_at`,
        [ev.id, leagueKey, ev.home_team, ev.away_team, ev.commence_time, status, JSON.stringify(ev), now]
      );
    }
  }

  /** @returns {Promise<import('./OddsProvider.js').NormalizedMatch[]>} */
  async listMatches({ league } = {}) {
    if (!ODDS_API_KEY) return [];
    const leagues = await this._getSoccerLeagues();
    const targetLeagues = league ? leagues.filter((l) => l.key === league) : leagues.filter(isTopLeague);
    for (const l of targetLeagues) {
      await this._refreshLeagueOdds(l.key);
    }
    const { rows } = league
      ? await pool.query('SELECT * FROM matches_cache WHERE league = $1 ORDER BY start_time ASC', [league])
      : await pool.query(
          'SELECT * FROM matches_cache WHERE league = ANY($1::text[]) ORDER BY start_time ASC',
          [targetLeagues.map((l) => l.key)]
        );
    return rows.map((row) => ({ ...mapEventToMatch(row), sourceProvider: this.name }));
  }

  async getMatch(matchId) {
    const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [matchId]);
    if (!rows[0]) return null;
    return { ...mapEventToMatch(rows[0]), sourceProvider: this.name };
  }

  async refreshOdds(matchId) {
    const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [matchId]);
    const row = rows[0];
    if (!row) return null;
    await this._refreshLeagueOdds(row.league);
    return this.getMatch(matchId);
  }
}
