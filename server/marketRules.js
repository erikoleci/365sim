// Pure, DB-free rules deciding whether a bet on a market may be accepted RIGHT NOW.
//
// The cheat this closes: someone watches the match on TV, sees that the first half
// ended X-X (or a goal / a corner / a card just happened) while our feed is still a
// few seconds behind, and bets on an outcome that is already decided. Before this,
// only 1X2 odds changes were checked. Now EVERY market goes through one function,
// getBetBlockReason(), at placement time -- and again after the live bet delay.
//
// Policy for a match that is in play:
//   * Markets whose outcome can be decided from the live score (totals, both teams to
//     score, correct score) are refused as soon as the live score already decides them.
//   * Markets that cannot be decided early (1X2, double chance, draw no bet, handicap,
//     odd/even) stay open -- the provider's own price moves handle those.
//   * Markets we have NO reliable live data for (player/scorer markets, corners, cards,
//     timing/next-goal markets, combinations, anything we cannot classify) are closed
//     in play: nothing proves what has already happened, so betting on them live would
//     be betting against information the player may already have. They stay available
//     before kick-off. No configuration can reopen them.
//
// Names are matched on the provider's own wording (Albanian), normalised.

import { normMarketText as norm, splitPeriod, PERIOD_BASE_ALIASES, isPastFirstHalf, getMarketClosedReason } from './marketPeriods.js';

// Shared with the settlement code (matchSettlement.js): both sides must agree on
// what each market is, so these sets live in exactly one place.
// 'totali' / 'total' are the short names used inside combination markets ("Rezultat Final & Totali").
export const TOTAL_GOALS_PREFIXES = ['numri i golave ne ndeshje', 'numri i golave', 'totali i golave', 'total goals', 'golat ne ndeshje', 'totali', 'total'];
export const H2H_NAMES = new Set(['rezultat final', 'rezultati final', '1x2', 'rezultati i ndeshjes', 'fituesi i ndeshjes']);
export const BTTS_NAMES = new Set(['gol/jogol', 'gol-jogol', 'gol / jogol', 'te dy skuadrat shenojne', 'both teams to score']);
export const DOUBLE_CHANCE_NAMES = new Set(['dopio shans', 'double chance', 'shans i dyfishte']);
export const CORRECT_SCORE_NAMES = new Set(['rezultati i sakte', 'rezultati ekzakt', 'correct score']);
// "Skuadra që shënon e para" / "First team to score": decided from the logged goal order
// (matchSettlement.js). Only these explicit team-based names; "Goli i Parë" may be a player
// market, so it is NOT claimed here.
export const FIRST_TEAM_TO_SCORE_NAMES = new Set([
  'skuadra qe shenon e pare', 'skuadra qe shenon e para', 'skuadra e pare qe shenon', 'skuadra qe shenon i pari',
  'ekipi qe shenon e pare', 'ekipi qe shenon i pari', 'first team to score', 'team to score first',
]);
export const LAST_TEAM_TO_SCORE_NAMES = new Set([
  'skuadra qe shenon e fundit', 'skuadra e fundit qe shenon', 'skuadra qe shenon i fundit', 'ekipi qe shenon i fundit',
  'ekipi qe shenon e fundit', 'last team to score', 'team to score last',
]);
// "Goli i Parë / i Fundit": settled ONLY when the selection is a side (1 / 2 / team / no goal);
// a player selection stays PENDING (the provider gives no scorer names). Not counted as
// auto-settling in the coverage report because the market name alone does not tell.
export const FIRST_GOAL_NAMES = new Set(['goli i pare', 'gola i pare', 'goli i pare ne ndeshje', 'first goal']);
export const LAST_GOAL_NAMES = new Set(['goli i fundit', 'gola i fundit', 'goli i fundit ne ndeshje', 'last goal']);
// "<Team> scores in both halves": settled only for a team selection (1 / 2 / team name).
export const BOTH_HALVES_NAMES = new Set([
  'shenon ne te dyja pjeset', 'shenojne ne te dyja pjeset', 'skuadra qe shenon ne te dyja pjeset',
  'shenon ne dy pjeset', 'ekipi qe shenon ne te dyja pjeset', 'team to score in both halves',
]);
export const GOAL_ORDER_NAMES = new Set([...FIRST_TEAM_TO_SCORE_NAMES, ...LAST_TEAM_TO_SCORE_NAMES, ...FIRST_GOAL_NAMES, ...LAST_GOAL_NAMES]);
export const HANDICAP_NAMES = new Set(['handikap', 'hendikep', 'handicap', 'handikap ne ndeshje', 'hendikep ne ndeshje']);

// Parses "Lart 1.5" / "Mbi 2,5" / "Over-2.5" / "Poshtë 3.5" / "Under 0.5".
export function parseOverUnder(text) {
  const m = norm(text).match(/^(lart|mbi|over|poshte|nen|under)[\s-]*([0-9]+(?:[.,][0-9]+)?)$/);
  if (!m) return null;
  const side = m[1] === 'lart' || m[1] === 'mbi' || m[1] === 'over' ? 'Over' : 'Under';
  const point = parseFloat(m[2].replace(',', '.'));
  return Number.isNaN(point) ? null : { side, point };
}

// -> { kind, period, side? }
//   kind: result | double_chance | dnb | handicap | odd_even | totals | team_totals | btts
//         | correct_score | htft | corners | cards | combo | other
//   period: 'H1' | 'H2' | null      side: 'home' | 'away' (team totals only)
export function classifyMarket(marketId, marketName, { home, away } = {}) {
  const id = String(marketId ?? '');
  const full = norm(marketName);
  const { period, base: rawBase } = splitPeriod(full);
  const base = PERIOD_BASE_ALIASES[rawBase] || rawBase;

  // canonical keys (The Odds API / our own mapping) carry their meaning in the id
  if (id.endsWith('-h2h')) return { kind: 'result', period };
  if (id.endsWith('-totals')) return { kind: 'totals', period };
  if (id.endsWith('-btts')) return { kind: 'btts', period };
  if (id.endsWith('-double_chance')) return { kind: 'double_chance', period };
  if (id.endsWith('-draw_no_bet')) return { kind: 'dnb', period };
  if (id.endsWith('-spreads')) return { kind: 'handicap', period };
  if (!full) return { kind: 'other', period };

  if (/korn|corner/.test(full)) return { kind: 'corners', period };
  if (/karton|\bcards?\b|booking/.test(full)) return { kind: 'cards', period };
  if (/&/.test(full)) return { kind: 'combo', period }; // "45/90 & Numri i Golave", "Pushim/Fund & Totali": never a plain htft
  if (/\bht\b|\bft\b|pushim\s*\/\s*fund|\b45\s*\/\s*90\b/.test(full)) return { kind: 'htft', period };
  if (/\bdhe\b|\+/.test(full)) return { kind: 'combo', period };

  if (H2H_NAMES.has(base)) return { kind: 'result', period };
  if (BTTS_NAMES.has(base)) return { kind: 'btts', period };
  if (DOUBLE_CHANCE_NAMES.has(base)) return { kind: 'double_chance', period };
  if (/\b(no bet|draw no bet)\b|barazimi = rimbursim/.test(full)) return { kind: 'dnb', period };
  if (TOTAL_GOALS_PREFIXES.includes(base)) return { kind: 'totals', period };
  for (const prefix of TOTAL_GOALS_PREFIXES) {
    if (home && base === `${prefix} ${norm(home)}`) return { kind: 'team_totals', period, side: 'home' };
    if (away && base === `${prefix} ${norm(away)}`) return { kind: 'team_totals', period, side: 'away' };
    if (['shtepiaku', 'vendasi', 'shtepise', 'home', 'host'].some((w) => base === `${prefix} ${w}`)) return { kind: 'team_totals', period, side: 'home' };
    if (['udhetuesi', 'mysafiri', 'mysafir', 'vizitori', 'vizitor', 'away', 'guest'].some((w) => base === `${prefix} ${w}`)) return { kind: 'team_totals', period, side: 'away' };
  }
  if (/\b(tek|odd)\b/.test(full) && /\b(cift|even)\b/.test(full)) return { kind: 'odd_even', period };
  if ((FIRST_TEAM_TO_SCORE_NAMES.has(base) || LAST_TEAM_TO_SCORE_NAMES.has(base)) && !period) return { kind: 'first_scorer', period };
  if (CORRECT_SCORE_NAMES.has(base)) return { kind: 'correct_score', period };
  if (HANDICAP_NAMES.has(base)) return { kind: 'handicap', period };
  return { kind: 'other', period };
}

function liveScore(row) {
  const h = row.live_home_score;
  const a = row.live_away_score;
  if (h == null || a == null) return null;
  const H = Number(h);
  const A = Number(a);
  return Number.isFinite(H) && Number.isFinite(A) ? { h: H, a: A } : null;
}

// Goals scored in the market's own period, or null when we cannot know them.
// First-half markets are closed after the first half elsewhere, so while they are
// open the current score IS the first-half score. Second half = score minus the
// half-time score captured at the whistle (null if we never captured it).
function periodScore(row, period, now) {
  const s = liveScore(row);
  if (!s) return null;
  if (period !== 'H2') return s;
  if (!isPastFirstHalf(row, now)) return { h: 0, a: 0 };
  if (row.ht_home == null || row.ht_away == null) return null;
  const h = s.h - Number(row.ht_home);
  const a = s.a - Number(row.ht_away);
  return h >= 0 && a >= 0 ? { h, a } : null;
}

// What the system does with a market, by name: can it be settled automatically, and can it
// be bet on while the match is in play. Shared by the admin coverage report and the guards.
// Kinds matchSettlement.js settles from the result (some need extra data: half-time score for
// htft and the 1st/2nd-half variants, corner/card counters for corners and cards).
// Corner / card markets the counters cannot decide: booking points,
// handicaps, first/second half, "which half", ... Used by matchSettlement (to leave the leg
// PENDING) and by describeMarket (so the coverage report says the same thing).
export const STATS_UNDECIDABLE = /pike|points|\bhandikap|\bhandicap|\bpare\b|\bdyte\b|\bfillim|\bfirst\b|\bpushim|\bnjeri\b/;
const stripP1P2 = (name) => String(name).replace(/p1\s*\+\s*p2/g, '');

const AUTO_SETTLES = new Set([
  'result', 'double_chance', 'dnb', 'handicap', 'odd_even', 'totals', 'team_totals', 'btts',
  'correct_score', 'htft', 'corners', 'cards', 'combo', 'first_scorer',
]);
// Kinds that stay open for betting while the match is in play (see marketRules.getBetBlockReason).
const OPEN_IN_PLAY = new Set([
  'result', 'double_chance', 'dnb', 'handicap', 'odd_even', 'totals', 'team_totals', 'btts', 'correct_score', 'htft',
]);

export function describeMarket(marketId, marketName) {
  let c = classifyMarket(marketId, marketName, {});
  // "Numri i Golave Zakynthos": a per-team total. classifyMarket needs the team names to tell
  // it apart, which a bare market name does not have, so recognise the shape by its prefix.
  if (c.kind === 'other') {
    const n = norm(marketName);
    if (TOTAL_GOALS_PREFIXES.some((p) => n.startsWith(p + ' '))) c = { ...c, kind: 'team_totals' };
  }
  return {
    kind: c.kind,
    period: c.period || null,
    autoSettles: AUTO_SETTLES.has(c.kind) && !((c.kind === 'corners' || c.kind === 'cards') && STATS_UNDECIDABLE.test(stripP1P2(norm(marketName)))),
    inPlay: OPEN_IN_PLAY.has(c.kind) ? 'open' : 'blocked',
  };
}

// BET_REQUIRE_SETTLEMENT_RULE=1: refuse (and show as locked) every market that has no
// automatic settlement rule, before the match as well as during it. That is what guarantees
// no accepted ticket can be left open for lack of a way to decide it; the price is that
// markets the system does not recognise disappear from the board. Off by default: look at
// GET /api/admin/market-coverage first to see how many markets that would remove.
export function settlementRuleRequired() {
  return ['1', 'true', 'yes'].includes(String(process.env.BET_REQUIRE_SETTLEMENT_RULE || '').toLowerCase());
}

// Markets with no verifiable live data (corners, cards, timing, next goal, players, combos...) are
// ALWAYS closed in play. The old LIVE_BET_UNVERIFIED_MARKETS=allow switch is gone on purpose: a
// forgotten environment variable must never reopen them (a ticket on such a market was accepted live).
export function unverifiedMarketsAllowed() {
  return false;
}

// ---- player markets -------------------------------------------------------------------------
// The feed gives no scorer / player names in results, so a bet on a player can never be settled:
// player markets are not offered at all (before kick-off or in play), and in "Goli i Parë / i Fundit"
// only the side options (1 / 2 / a team / no goal) are kept; player-name options are dropped.
const PLAYER_MARKET = /\b(lojtar\w*|shenues\w*|golashenues\w*|autor\w*|scorers?|goalscorers?|players?)\b/;
export const isPlayerMarketName = (name) => PLAYER_MARKET.test(norm(name));
const NO_GOAL_OPTIONS = new Set(['asnje', 'asnje gol', 'pa gol', 'nuk ka gol', 'no goal', 'none', 'no scorer']);
const SIDE_OPTIONS = new Set(['1', '2', 'x', 'home', 'away', 'draw', 'shtepi', 'mik', 'barazim']);
const teamKey = (v) => norm(v).replace(/[^a-z0-9]+/g, '');
const isGoalOrderMarketName = (name) => GOAL_ORDER_NAMES.has(norm(name));
// True when `option` of the goal-order market is a player name (not a side / team / no goal).
export function isPlayerOption(marketName, option, home, away) {
  if (!isGoalOrderMarketName(marketName)) return false;
  const text = norm(option && (option.name ?? option.id));
  const id = norm(option && option.id);
  if (SIDE_OPTIONS.has(text) || SIDE_OPTIONS.has(id) || NO_GOAL_OPTIONS.has(text)) return false;
  const key = teamKey(text);
  if (key && (key === teamKey(home) || key === teamKey(away))) return false;
  return true;
}
// Removes player markets and player options from a market list (what the board offers).
export function hidePlayerOdds(markets, home, away) {
  const out = [];
  for (const m of markets || []) {
    if (isPlayerMarketName(m.name)) continue;
    if (!isGoalOrderMarketName(m.name)) { out.push(m); continue; }
    const options = (m.options || []).filter((o) => !isPlayerOption(m.name, o, home, away));
    if (options.length) out.push(options.length === (m.options || []).length ? m : { ...m, options });
  }
  return out;
}

// Market names that are tied to a minute window or a moment ("0-15 minuta", "Minuta e Golit",
// "gol brenda 5 minutash", next goal): closed in play whatever else the name looks like.
const TIMING_MARKET = /\bminut\w*|\bmin\b|\d+\s*['\u2019]|\b(i|e) rradhes|\b(golin|gola|goli) e (rradh|radh)\w*|\bnext goal\b|\bgol(i|a)? ne\b.*\d/;

const NOT_VERIFIABLE = 'NOT_VERIFIABLE_LIVE';
const NO_PLAYER_DATA = 'NO_PLAYER_DATA';
const NO_RULE = 'NO_SETTLEMENT_RULE';
const DECIDED = 'OUTCOME_DECIDED';

// Why a bet on `selection` of `market` must be refused for this matches_cache row
// right now, or null if it may be accepted.
//   code: MATCH_FINISHED | FIRST_HALF_OVER | OUTCOME_DECIDED | NOT_VERIFIABLE_LIVE
// Before kick-off nothing here applies (pre-match betting is unrestricted).
export function getBetBlockReason(row, market, selection, now = Date.now(), { allowUnverified } = {}) {
  if (!row) return null;
  const closed = getMarketClosedReason(row, market && market.name, now);
  if (closed) return closed; // MATCH_FINISHED | FIRST_HALF_OVER

  if (settlementRuleRequired() && !describeMarket(market && market.id, market && market.name).autoSettles) return NO_RULE;

  // Player markets / player options: never offered (no scorer names to settle them with).
  if (market && isPlayerMarketName(market.name)) return NO_PLAYER_DATA;
  if (market && isPlayerOption(market.name, selection, row.home_team, row.away_team)) return NO_PLAYER_DATA;

  const kickoff = Date.parse(row.start_time);
  if (!Number.isFinite(kickoff) || kickoff > now) return null; // not in play yet

  if (market && TIMING_MARKET.test(norm(market.name))) return NOT_VERIFIABLE;

  const c = classifyMarket(market && market.id, market && market.name, { home: row.home_team, away: row.away_team });
  const sel = selection || {};

  switch (c.kind) {
    case 'result':
    case 'double_chance':
    case 'dnb':
    case 'handicap':
    case 'odd_even':
      return null; // cannot be decided before the end by the score alone

    case 'htft':
      return isPastFirstHalf(row, now) ? 'FIRST_HALF_OVER' : null;

    case 'totals':
    case 'team_totals': {
      const ps = periodScore(row, c.period, now);
      const ou = parseOverUnder(sel.id) || parseOverUnder(sel.name);
      if (!ps || !ou) return NOT_VERIFIABLE;
      const goals = c.kind === 'totals' ? ps.h + ps.a : c.side === 'home' ? ps.h : ps.a;
      // Over X: already won once goals pass X. Under X: already lost once goals pass X.
      return goals > ou.point ? DECIDED : null;
    }

    case 'btts': {
      const ps = periodScore(row, c.period, now);
      if (!ps) return NOT_VERIFIABLE;
      return ps.h > 0 && ps.a > 0 ? DECIDED : null; // both have scored: Yes won / No lost
    }

    case 'correct_score': {
      const ps = periodScore(row, c.period, now);
      if (!ps) return NOT_VERIFIABLE;
      const m = String(sel.name || sel.id || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (!m) return null; // "any other score": not decided by the current score
      return ps.h > Number(m[1]) || ps.a > Number(m[2]) ? DECIDED : null; // already impossible
    }

    // corners, cards, combos and everything unrecognised (player / scorer / timing...)
    default:
      return allowUnverified === true ? null : NOT_VERIFIABLE; // only an explicit test flag; never config
  }
}

// Human-readable text for the API error and the log line.
export function describeBlockReason(code) {
  switch (code) {
    case 'MATCH_FINISHED': return 'the match has finished';
    case 'FIRST_HALF_OVER': return 'the first half is over';
    case 'OUTCOME_DECIDED': return 'the outcome is already decided by the current score';
    case 'NO_PLAYER_DATA': return 'player odds are not offered (the feed does not provide player names)';
    case 'NO_SETTLEMENT_RULE': return 'this market cannot be settled automatically, so it is not offered';
    case 'NOT_VERIFIABLE_LIVE': return 'this market cannot be verified against live data, so it is only open before kick-off';
    default: return 'it is closed';
  }
}
