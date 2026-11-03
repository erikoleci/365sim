// One generic rule behind every live market: a selection whose result is ALREADY certain from what has happened
// (score, corner / card counters) is not offered and not accepted. It does not look at the market type, it asks the
// settlement rules themselves: "in EVERY possible continuation of the match, does this leg end the same way?"
// If yes (won or lost), betting on it is pointless or a free win, so it is closed (code OUTCOME_DECIDED).
// The per-market rules in marketRules.js stay as they are (they also know periods and the provider's special
// markets); this is the net under them for everything they do not spell out.
import { sureOutcome, isStatsMarketName } from './matchSettlement.js';
import { marketPeriod, EXTRA_TIME_STATUSES } from './marketPeriods.js';

const DECIDED = 'OUTCOME_DECIDED';
const norm = (s) => String(s || '').trim();

const isLive = (row) => Boolean(row) && (row.status === 'LIVE' || row.live_status != null);

// Same exclusions as the early settlement of live tickets (settleLostLiveLegs): half markets close at their own
// whistle (marketRules/periods handle them) and extra time is left to the specific rules.
function judgeable(row, market) {
  const name = norm(market && market.name);
  if (!name) return false;
  if (marketPeriod(name) !== null) return false;
  if (EXTRA_TIME_STATUSES.has(String(row.live_status || '').toUpperCase())) return false;
  return true;
}

// `stats` = { cornersHome, cornersAway, cardsHome, cardsAway, yellow*, red* } for corner / card markets, if known.
export function certainOutcomeReason(row, market, selection, stats) {
  if (!isLive(row) || !judgeable(row, market)) return null;
  const h = Number(row.live_home_score); const a = Number(row.live_away_score);
  if (row.live_home_score == null || row.live_away_score == null || !Number.isFinite(h) || !Number.isFinite(a)) return null;
  const leg = {
    market_id: market.id, market_name: market.name,
    selection_id: selection && selection.id, selection_name: selection && (selection.name || selection.id),
  };
  const isStats = isStatsMarketName(market.name);
  if (isStats && !stats) return null; // no counters: nothing is claimed (the specific live rules still apply)
  try {
    return sureOutcome(leg, { h, a }, isStats ? stats : undefined) ? DECIDED : null;
  } catch { return null; }
}
