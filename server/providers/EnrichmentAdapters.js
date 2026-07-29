// server/providers/EnrichmentAdapters.js
//
// bsd, odds-api.io, highlightly, and oddspapi are not primary match
// sources — they enrich matches already cached by the primary provider
// (extra bookmaker odds, or live score updates) except for odds-api.io's
// "primary leagues" mode (e.g. Albania Superliga), which The Odds API
// doesn't cover at all. All four are wrapped here as adapters implementing
// the same OddsProvider interface so they can be registered, toggled, and
// swapped identically to the primary provider — no special-casing anywhere
// else in the codebase.

import { OddsProvider } from './OddsProvider.js';
import { refreshBsd } from '../bsd.js';
import { refreshHighlightly } from '../highlightly.js';
import { refreshOddsApiIo, refreshPrimaryLeagues } from '../oddsapiio.js';
import { refreshOddsPapi } from '../oddspapi.js';
import pool from '../db.js';
import { mapEventToMatch } from '../oddsUtils.js';

class EnrichmentAdapter extends OddsProvider {
  constructor(name, refreshFn) {
    super();
    this.name = name;
    this._refreshFn = refreshFn;
  }

  /** Enrichment adapters don't own matches — they only top up matches_cache
   *  rows written by the primary provider (or, for odds-api.io primary
   *  leagues, write rows directly). listMatches() still works for
   *  consistency, but is only meaningful when league is passed. */
  async listMatches({ league } = {}) {
    await this._safeRefresh();
    const { rows } = league
      ? await pool.query('SELECT * FROM matches_cache WHERE league = $1 ORDER BY start_time ASC', [league])
      : await pool.query('SELECT * FROM matches_cache ORDER BY start_time ASC LIMIT 200');
    return rows.map((row) => ({ ...mapEventToMatch(row), sourceProvider: this.name }));
  }

  async getMatch(matchId) {
    const { rows } = await pool.query('SELECT * FROM matches_cache WHERE id = $1', [matchId]);
    if (!rows[0]) return null;
    return { ...mapEventToMatch(rows[0]), sourceProvider: this.name };
  }

  async refreshOdds() {
    await this._safeRefresh();
    return null;
  }

  async _safeRefresh() {
    try {
      await this._refreshFn();
    } catch (err) {
      console.error(`[${this.name}] enrichment refresh failed:`, err.message);
    }
  }
}

export const bsdAdapter = new EnrichmentAdapter('bsd', refreshBsd);
export const highlightlyAdapter = new EnrichmentAdapter('highlightly', refreshHighlightly);
export const oddsPapiAdapter = new EnrichmentAdapter('oddspapi', refreshOddsPapi);
export const oddsApiIoAdapter = new EnrichmentAdapter('odds-api-io', async () => {
  await refreshOddsApiIo();
  await refreshPrimaryLeagues();
});

export const ALL_ENRICHMENT_ADAPTERS = [bsdAdapter, highlightlyAdapter, oddsPapiAdapter, oddsApiIoAdapter];
