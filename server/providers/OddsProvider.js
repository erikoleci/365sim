// server/providers/OddsProvider.js
//
// Common interface every odds provider adapter must implement.
// The rest of the app (matches route, bet verification, settlement)
// only ever talks to this interface — never to a provider's raw response
// shape. Adding a new bookmaker/data source = write one adapter class
// that implements these three methods and register it in registry.js.
// No UI or route code should ever change when a provider is added.

export class OddsProvider {
  /** @returns {Promise<NormalizedMatch[]>} */
  async listMatches(/* { sport, league, from, to } */) {
    throw new Error("listMatches() not implemented");
  }

  /** @returns {Promise<NormalizedMatch|null>} */
  async getMatch(/* matchId */) {
    throw new Error("getMatch() not implemented");
  }

  /** @returns {Promise<NormalizedMatch|null>} live score/odds refresh */
  async refreshOdds(/* matchId */) {
    throw new Error("refreshOdds() not implemented");
  }
}

/**
 * @typedef {Object} NormalizedMarketOption
 * @property {string} id
 * @property {string} name
 * @property {number} odds
 *
 * @typedef {Object} NormalizedMarket
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {NormalizedMarketOption[]} options
 *
 * @typedef {Object} NormalizedMatch
 * @property {string} id
 * @property {string} sport            // e.g. "football", "basketball" — enables unlimited sports
 * @property {string} league
 * @property {string} country
 * @property {string} season
 * @property {string} homeTeam
 * @property {string} awayTeam
 * @property {string} startTime        // ISO 8601
 * @property {"UPCOMING"|"LIVE"|"FINISHED"} status
 * @property {NormalizedMarket[]} markets   // unlimited markets, rendered dynamically by the frontend
 * @property {{home:number, away:number}|null} liveScore
 * @property {string} sourceProvider   // which adapter produced this, for debugging/audit
 */
