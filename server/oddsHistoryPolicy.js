// Decides whether a price move gets persisted into odds_history.
//
// Findings that motivate this (see analysis): nothing in the app READS
// odds_history - the /api/matches/:id/odds-history route exists, but no
// frontend code calls it, settlement uses bet_selections.odds (the price the
// user was actually given), not history - while the live feed writes one row
// per selection per price move for EVERY tracked match, all day.
//
// ODDS_HISTORY_MODE:
//   bets_only (default) - record only for matches that have at least one
//                         PENDING bet selection (the only case where "how did
//                         the price move" can matter for a dispute).
//   all                 - previous behaviour, every price move.
//   off                 - never record from the live feed.
//
// FAIL-OPEN: until the set of matches-with-bets has been loaded once, bets_only
// records everything (old behaviour), so a DB hiccup at boot never silently
// loses history for a match somebody bet on.
import pool from './db.js';

const RAW = String(process.env.ODDS_HISTORY_MODE || 'bets_only').toLowerCase();
const MODE = ['all', 'bets_only', 'off'].includes(RAW) ? RAW : 'bets_only';

const betMatchIds = new Set();
let hydrated = false;

export function oddsHistoryMode() { return MODE; }

export function shouldRecordOddsHistory(matchId) {
  if (MODE === 'all') return true;
  if (MODE === 'off') return false;
  if (!hydrated) return true;
  return betMatchIds.has(String(matchId));
}

// Called right after a bet is committed so history starts recording for that
// match from the very next price move.
export function noteBetOnMatches(matchIds) {
  for (const id of matchIds || []) if (id != null) betMatchIds.add(String(id));
}

export async function hydrateBetMatchIds() {
  if (MODE !== 'bets_only') return 0;
  const { rows } = await pool.query("SELECT DISTINCT match_id FROM bet_selections WHERE status = 'PENDING'");
  betMatchIds.clear();
  for (const r of rows) betMatchIds.add(String(r.match_id));
  hydrated = true;
  return betMatchIds.size;
}

export function __resetOddsHistoryPolicyForTests() {
  betMatchIds.clear();
  hydrated = false;
}
