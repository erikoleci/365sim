import pool from './db.js';
import { minuteOf, splitPeriod, PERIOD_BASE_ALIASES } from './marketPeriods.js';
import {
  TOTAL_GOALS_PREFIXES, H2H_NAMES, BTTS_NAMES, DOUBLE_CHANCE_NAMES, CORRECT_SCORE_NAMES, HANDICAP_NAMES, parseOverUnder,
  STATS_UNDECIDABLE, FIRST_TEAM_TO_SCORE_NAMES, LAST_TEAM_TO_SCORE_NAMES, FIRST_GOAL_NAMES, LAST_GOAL_NAMES, BOTH_HALVES_NAMES, GOAL_ORDER_NAMES,
} from './marketRules.js';

// ---- first / second half markets ------------------------------------------
// "Rezultati Pjesa e Parë", "Numri i Golave në Pjesën e Dytë", "1X2 1st Half" ...
// The period phrase is cut out of the (normalised) market name and what is left
// must be one of the known base markets, otherwise the leg stays PENDING for
// manual review (HT/FT doubles, "which half has more goals" etc. never match).
// First half uses the stored half-time score (matches_cache.ht_home/ht_away,
// captured at the whistle); second half is final score minus half-time score.
// (period phrases, name sets and Over/Under parsing live in marketPeriods.js / marketRules.js,
// shared with the betting rules so both sides always agree on what a market is.)

const HTFT_NAMES = new Set(['pushim/fund', 'pushimi/fundi', 'pushim / fund', 'pushim fund', 'ht/ft', 'ht ft', 'pjesa e pare/finale', 'pjesa e pare/fund']);

// "Rezultat Final & Totali" + "1 & Lart 2.5"  ->  two single legs. Only when market
// and selection split into the same number (2-3) of parts, otherwise not a combo.
function splitCombo(leg) {
  const marketParts = String(leg.market_name || '').split(/\s*&\s*/);
  const selection = String(leg.selection_name || leg.selection_id || '');
  const selectionParts = selection.split(/\s*&\s*/);
  if (marketParts.length < 2 || marketParts.length > 3 || marketParts.length !== selectionParts.length) return null;
  return marketParts.map((m, i) => ({
    ...leg,
    market_id: '',
    market_name: m.trim(),
    selection_id: selectionParts[i].trim(),
    selection_name: selectionParts[i].trim(),
  }));
}

const STATS_MARKET = /korn|corner|karton|\bcards?\b|booking/;
const legNeedsStats = (leg) => STATS_MARKET.test(norm(leg.market_name));
const legNeedsFirstScorer = (leg) => GOAL_ORDER_NAMES.has(norm(leg.market_name))
  || (splitCombo(leg) || []).some((p) => GOAL_ORDER_NAMES.has(norm(p.market_name)));

// Final corner / card counters of a match, or undefined if there are none (or the
// lookup fails -- the leg then simply stays PENDING).
async function loadMatchStats(client, matchId) {
  try {
    const { rows } = await client.query(
      'SELECT corners_home, corners_away, cards_home, cards_away FROM live_statistics WHERE match_id = $1', [matchId]);
    const r = rows[0];
    if (!r) return undefined;
    return { cornersHome: r.corners_home, cornersAway: r.corners_away, cardsHome: r.cards_home, cardsAway: r.cards_away };
  } catch { return undefined; }
}

// Goal order of a finished match: { first, last } each 'HOME' | 'AWAY' | 'NONE' (0-0), or
// undefined when it cannot be trusted. The logged GOAL events (recordGoalIfChanged) are used
// only if they add up to the final score for each team (a match first seen at 2-1 or a server
// gap leaves events missing); a first/last goal tied in time with a goal of the other team is
// not trusted either.
async function loadGoalOrder(client, match, homeScore, awayScore) {
  try {
    if (homeScore + awayScore === 0) return { first: 'NONE', last: 'NONE' };
    const { rows } = await client.query(
      `SELECT team, created_at FROM match_events WHERE match_id = $1 AND type = 'GOAL' ORDER BY created_at, id`, [match.id]);
    return goalOrderFromEvents(rows, match.home_team, match.away_team, homeScore, awayScore);
  } catch { return undefined; }
}

export function goalOrderFromEvents(events, homeTeam, awayTeam, homeScore, awayScore) {
  if (homeScore + awayScore === 0) return { first: 'NONE', last: 'NONE' };
  const nHome = events.filter((e) => e.team === homeTeam).length;
  const nAway = events.filter((e) => e.team === awayTeam).length;
  if (nHome !== homeScore || nAway !== awayScore || !events.length) return undefined;
  const side = (e) => (e.team === homeTeam ? 'HOME' : e.team === awayTeam ? 'AWAY' : undefined);
  const pick = (e) => (events.some((o) => o.team !== e.team && Number(o.created_at) === Number(e.created_at)) ? undefined : side(e));
  return { first: pick(events[0]), last: pick(events[events.length - 1]) };
}
export const firstScorerFromEvents = (...args) => { const g = goalOrderFromEvents(...args); return g ? g.first : undefined; };

// Pure decision logic for a single bet leg given the final match result.
// Kept separate from settleMatch (which is DB-coupled) so it can be unit
// tested without a database. Returns 'WON' | 'LOST' | null (null = leave
// PENDING for manual review — used for markets/lines we don't auto-settle).
// Lowercase + strip diacritics + collapse whitespace so "Poshtë", "Nën",
// "Numri i Golave ne Ndeshje" all compare reliably.
function norm(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Provider markets that are NOT in CANONICAL_MARKETS (london365.js) get a
// unique market_id like "numri_i_golave_ne_ndeshje_m123" and their
// selection_id is the raw option text ("Lart 1.5"). Those never matched the
// "-xyz" suffix checks, so e.g. "Numri i Golave ne Ndeshje -> Lart 1.5" stayed
// PENDING forever. Every market that can be decided from the FINAL SCORE
// alone is therefore also recognised by its (normalised) market NAME.
// Half-time / period markets, combos ("&") and quarter-handicaps are never
// auto-settled from the final score: they stay PENDING for manual review
// instead of being settled wrongly.
const PERIOD_OR_COMBO = /(pjes|pjese|half|1st|2nd|\bht\b|\bft\b|&| dhe |\+|minut|kend|korner|karton|faull|corner|card)/;


// Whole-number line landing exactly on the total is a push -> stake refunded.
function overUnderOutcome(side, point, goals) {
  if (Number.isNaN(point)) return null;
  if (point === goals) return 'VOID';
  if (side === 'Over') return goals > point ? 'WON' : 'LOST';
  if (side === 'Under') return goals < point ? 'WON' : 'LOST';
  return null;
}

// "1X" / "x2" / "1-2" / "1/X" -> canonical "1X" | "X2" | "12" | null
function normDoubleChance(text) {
  const t = String(text ?? '').toUpperCase().replace(/[\s/\-_]/g, '');
  if (t === '1X' || t === 'X1') return '1X';
  if (t === 'X2' || t === '2X') return 'X2';
  if (t === '12' || t === '21') return '12';
  return null;
}

// Which side a "home / away" style selection refers to, or null.
function sideOfSelection(leg) {
  const id = String(leg.selection_id ?? '').toUpperCase();
  const name = norm(leg.selection_name);
  if (id === 'HOME' || id === '1' || name === '1' || (leg.match_home && name === norm(leg.match_home))) return 'HOME';
  if (id === 'AWAY' || id === '2' || name === '2' || (leg.match_away && name === norm(leg.match_away))) return 'AWAY';
  if (id === 'DRAW' || id === 'X' || name === 'x') return 'DRAW';
  return null;
}

function parseHandicap(leg) {
  const text = String(leg.selection_name || leg.selection_id || '');
  const m = text.trim().match(/^(.*?)\s*\(\s*([+-]?\d+(?:[.,]\d+)?)\s*\)\s*$/);
  if (!m) return null;
  const point = parseFloat(m[2].replace(',', '.'));
  if (Number.isNaN(point) || (point * 2) % 1 !== 0) return null; // quarter lines: manual
  const who = norm(m[1]);
  let side = null;
  if (who === '1' || (leg.match_home && who === norm(leg.match_home))) side = 'HOME';
  else if (who === '2' || (leg.match_away && who === norm(leg.match_away))) side = 'AWAY';
  return side ? { side, point } : null;
}

// Pure decision logic for a single bet leg given the final match result.
// Kept separate from settleMatch (which is DB-coupled) so it can be unit
// tested without a database. Returns 'WON' | 'LOST' | 'VOID' (stake
// refunded, e.g. a push) | null (null = leave PENDING for manual review).
// Corners / cards come from live_statistics (cumulative counters the live feed keeps
// current until the whistle). `stats` is { cornersHome, cornersAway, cardsHome, cardsAway }
// or undefined when we have no counters for the match -- then the leg stays PENDING.
// cards = yellow + red per team (how the feed counts them); booking-points, "red card"
// and first-half corner/card markets are NOT decided here (no data), they stay PENDING.
function statsOutcome(leg, marketName, stats, { home, away }) {
  const isCorners = /korn|corner/.test(marketName);
  const isCards = /karton|\bcards?\b|booking/.test(marketName);
  if (!isCorners && !isCards) return undefined; // not a stats market
  if (!stats) return null;
  if (STATS_UNDECIDABLE.test(marketName.replace(/p1\s*\+\s*p2/g, ''))) return null;
  const h = Number(isCorners ? stats.cornersHome : stats.cardsHome);
  const a = Number(isCorners ? stats.cornersAway : stats.cardsAway);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  let total = h + a;
  const rest = marketName.replace(/p1\s*\+\s*p2/g, '');
  if (home && rest.includes(norm(home))) total = h;
  else if (away && rest.includes(norm(away))) total = a;
  else if (/\b(skuadra|team)\b|\b1\b|\b2\b/.test(rest) && !/\b(shuma|totali|total)\b/.test(rest)) return null; // team market we cannot attribute
  const text = norm(leg.selection_name || leg.selection_id);
  const ou = parseOverUnder(leg.selection_id) || parseOverUnder(leg.selection_name);
  if (ou) return overUnderOutcome(ou.side, ou.point, total);
  let m = text.match(/^(\d+)\s*\+$/); // "5+" = at least 5
  if (m) return total >= Number(m[1]) ? 'WON' : 'LOST';
  m = text.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/); // "3-5"
  if (m) return total >= Number(m[1]) && total <= Number(m[2]) ? 'WON' : 'LOST';
  return null; // any other label (e.g. "5+|6+") has no agreed meaning: manual
}

export function determineLegOutcome(leg, { winner, totalGoals, bothScored, homeScore, awayScore, htHome, htAway, stats, goalOrder }) {
  const marketId = String(leg.market_id ?? '');
  const hasScore = Number.isFinite(homeScore) && Number.isFinite(awayScore);

  // ---- canonical keys ----
  if (marketId.endsWith('-h2h')) {
    return leg.selection_id === winner ? 'WON' : 'LOST';
  }
  if (marketId.endsWith('-totals')) {
    const idx = leg.selection_id.lastIndexOf('-');
    return overUnderOutcome(leg.selection_id.slice(0, idx), parseFloat(leg.selection_id.slice(idx + 1)), totalGoals);
  }
  if (marketId.endsWith('-btts')) {
    if (leg.selection_id === 'Yes') return bothScored ? 'WON' : 'LOST';
    if (leg.selection_id === 'No') return !bothScored ? 'WON' : 'LOST';
  }

  // ---- name-based (also covers canonical keys with unusual option text) ----
  const marketName = norm(leg.market_name);
  if (!marketName) return null;

  // ---- combination markets: "Rezultat Final & Totali" -> "1 & Lart 2.5" ----
  // Every part must win. One part that LOSES decides the whole bet at once, even
  // if another part is not understood; otherwise all parts must be understood and
  // won. A refunded (VOID) part is left for manual review: its payout rule differs.
  const combo = splitCombo(leg);
  if (combo) {
    const outcomes = combo.map((sub) => determineLegOutcome(sub, { winner, totalGoals, bothScored, homeScore, awayScore, htHome, htAway, stats, goalOrder }));
    if (outcomes.includes('LOST')) return 'LOST';
    if (outcomes.every((o) => o === 'WON')) return 'WON';
    return null;
  }

  // ---- half-time / full-time double: "Pushim/Fund" -> "1/2" ----
  if (HTFT_NAMES.has(marketName)) {
    const m = String(leg.selection_name || leg.selection_id).trim().toLowerCase().match(/^([12x])\s*[\/-]\s*([12x])$/);
    if (!m || !hasScore || !Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
    const sign = (h, a) => (h > a ? '1' : a > h ? '2' : 'x');
    return sign(htHome, htAway) === m[1] && sign(homeScore, awayScore) === m[2] ? 'WON' : 'LOST';
  }

  const { period, base } = splitPeriod(marketName);
  if (period) {
    // Needs the half-time score; without it (e.g. the server was down at HT) the
    // leg is left PENDING rather than guessed.
    if (!hasScore || !Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
    const h = period === 'H1' ? htHome : homeScore - htHome;
    const a = period === 'H1' ? htAway : awayScore - htAway;
    if (h < 0 || a < 0) return null;
    return determineLegOutcome(
      { ...leg, market_id: '', market_name: PERIOD_BASE_ALIASES[base] || base },
      { winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0, homeScore: h, awayScore: a }
    );
  }
  // first / last team to score, first / last goal (side selections only): from the goal order
  const wantsFirst = FIRST_TEAM_TO_SCORE_NAMES.has(marketName) || FIRST_GOAL_NAMES.has(marketName);
  const wantsLast = LAST_TEAM_TO_SCORE_NAMES.has(marketName) || LAST_GOAL_NAMES.has(marketName);
  if (wantsFirst || wantsLast) {
    const actual = goalOrder && (wantsFirst ? goalOrder.first : goalOrder.last);
    if (!actual) return null; // goal order not reliable: stays PENDING
    const sel = norm(leg.selection_name || leg.selection_id);
    const side = sideOfSelection(leg);
    if (side === 'HOME' || side === 'AWAY') return side === actual ? 'WON' : 'LOST';
    if (/^(asnje|asnje gol|no goal|none|pa gol|x)$/.test(sel)) return actual === 'NONE' ? 'WON' : 'LOST';
    return null; // a player or any other label: no scorer names -> manual
  }
  // "<team> scores in both halves" (team selections) and the Po/Jo form "Shënojnë në të dyja pjesët".
  if (BOTH_HALVES_NAMES.has(marketName)) {
    const side = sideOfSelection(leg);
    if (!hasScore || !Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
    if (side !== 'HOME' && side !== 'AWAY') {
      // Po/Jo: the label does not say whether it means (A) "both teams score in both halves" or
      // (B) "there are goals in both halves". A implies B, so a result is only decided when
      // every reading agrees: Po wins if A holds, Jo wins if B fails; A false but B true is
      // exactly where the readings differ -> stays PENDING (never guessed).
      const sel = norm(leg.selection_name || leg.selection_id);
      const yes = sel === 'po' || sel === 'yes';
      const no = sel === 'jo' || sel === 'no';
      if (!yes && !no) return null;
      const h2 = homeScore - htHome;
      const a2 = awayScore - htAway;
      if (h2 < 0 || a2 < 0) return null;
      const readingA = htHome > 0 && htAway > 0 && h2 > 0 && a2 > 0;
      const readingB = htHome + htAway > 0 && h2 + a2 > 0;
      if (readingA) return yes ? 'WON' : 'LOST';
      if (!readingB) return yes ? 'LOST' : 'WON';
      return null;
    }
    const first = side === 'HOME' ? htHome : htAway;
    const total = side === 'HOME' ? homeScore : awayScore;
    if (total - first < 0) return null;
    return first > 0 && total - first > 0 ? 'WON' : 'LOST';
  }
  const so = statsOutcome(leg, marketName, stats, { home: leg.match_home && norm(leg.match_home), away: leg.match_away && norm(leg.match_away) });
  if (so !== undefined) return so;
  if (PERIOD_OR_COMBO.test(marketName)) return null;

  if (H2H_NAMES.has(marketName)) {
    const side = sideOfSelection(leg);
    return side ? (side === winner ? 'WON' : 'LOST') : null;
  }

  if (BTTS_NAMES.has(marketName) || marketId.endsWith('-btts')) {
    const sel = norm(leg.selection_name || leg.selection_id);
    if (sel === 'po' || sel === 'yes' || sel === 'gol') return bothScored ? 'WON' : 'LOST';
    if (sel === 'jo' || sel === 'no' || sel === 'jogol') return !bothScored ? 'WON' : 'LOST';
    return null;
  }

  if (DOUBLE_CHANCE_NAMES.has(marketName) || marketId.endsWith('-double_chance')) {
    const dc = normDoubleChance(leg.selection_id) || normDoubleChance(leg.selection_name);
    if (!dc) return null;
    const ok = dc === '1X' ? winner !== 'AWAY' : dc === 'X2' ? winner !== 'HOME' : winner !== 'DRAW';
    return ok ? 'WON' : 'LOST';
  }

  if (marketId.endsWith('-draw_no_bet') || /\b(no bet|draw no bet)\b|barazimi = rimbursim/.test(marketName)) {
    const side = sideOfSelection(leg);
    if (side !== 'HOME' && side !== 'AWAY') return null;
    if (winner === 'DRAW') return 'VOID';
    return side === winner ? 'WON' : 'LOST';
  }

  // Total goals of the whole match
  if (TOTAL_GOALS_PREFIXES.includes(marketName)) {
    const parsed = parseOverUnder(leg.selection_id) || parseOverUnder(leg.selection_name);
    if (parsed) return overUnderOutcome(parsed.side, parsed.point, totalGoals);
  }

  // Odd / even total goals ("Tek/Çift")
  if (/\b(tek|odd)\b/.test(marketName) && /\b(cift|even)\b/.test(marketName)) {
    const sel = norm(leg.selection_name || leg.selection_id);
    const odd = totalGoals % 2 === 1;
    if (sel === 'tek' || sel === 'odd') return odd ? 'WON' : 'LOST';
    if (sel === 'cift' || sel === 'even') return !odd ? 'WON' : 'LOST';
    return null;
  }

  if (!hasScore) return null;

  // Exact final score
  if (CORRECT_SCORE_NAMES.has(marketName)) {
    const m = String(leg.selection_name || leg.selection_id).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (!m) return null; // "Tjetër" / any-other-score: manual
    return Number(m[1]) === homeScore && Number(m[2]) === awayScore ? 'WON' : 'LOST';
  }

  // Team-specific total goals: "<prefix> <team name>"
  for (const prefix of TOTAL_GOALS_PREFIXES) {
    for (const [team, goals] of [[leg.match_home, homeScore], [leg.match_away, awayScore]]) {
      if (team && marketName === `${prefix} ${norm(team)}`) {
        const parsed = parseOverUnder(leg.selection_id) || parseOverUnder(leg.selection_name);
        if (parsed) return overUnderOutcome(parsed.side, parsed.point, goals);
      }
    }
  }

  // Handicap (whole / half lines only)
  if (HANDICAP_NAMES.has(marketName) || marketId.endsWith('-spreads')) {
    const h = parseHandicap(leg);
    if (!h) return null;
    const diff = h.side === 'HOME' ? homeScore + h.point - awayScore : awayScore + h.point - homeScore;
    if (diff === 0) return 'VOID';
    return diff > 0 ? 'WON' : 'LOST';
  }

  return null;
}

// Credits a user's balance for a settled ticket AND records it in the transactions ledger,
// in the caller's transaction (the bet row is already locked). Stake deductions and cancel
// refunds were already ledgered; settlement payouts and void refunds were not, so a balance
// could change with no trace. A failed ledger write fails (and rolls back) the whole
// settlement, which the sweeps then retry: money must never move without a record.
// type: 'BET_WIN_PAYOUT' | 'BET_VOID_REFUND'; reference: the bet id.
async function creditWithLedger(client, userId, amount, type, betId) {
  const { rows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!rows[0]) return; // user no longer exists: nothing to credit
  const before = Number(rows[0].balance);
  const after = Math.round((before + Number(amount)) * 100) / 100;
  await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, userId]);
  await client.query(
    `INSERT INTO transactions
      (actor_id, source_id, target_id, amount, type, reference,
       source_balance_before, source_balance_after, target_balance_before, target_balance_after, created_at)
     VALUES ($1,$1,$1,$2,$3,$4,$5,$6,$5,$6,$7)`,
    [userId, amount, type, betId, before, after, Date.now()]
  );
}

// Recompute a bet's overall status from its legs, and pay out balance
// exactly once, the moment it transitions into WON (or VOID = refund).
//
// VOID legs (pushes) are dropped from the ticket: the remaining legs decide
// it and the payout is recalculated without them (stake x odds of the
// non-void legs). A ticket whose legs are ALL void is refunded its stake.
//
// `FOR UPDATE` on the bet row is what makes this safe under concurrent
// calls (e.g. the admin manual-settle route and the automatic live
// poller both reacting to the same match around the same time): it
// forces a second concurrent call for the same betId to block until the
// first one commits, then re-read the ALREADY-UPDATED status — so its
// `nextStatus === bet.status` check below correctly short-circuits
// instead of paying out a second time.
export async function recomputeBetStatus(betId, client = pool) {
  const { rows: betRows } = await client.query('SELECT * FROM bets WHERE id = $1 FOR UPDATE', [betId]);
  const bet = betRows[0];
  if (!bet) return;
  const { rows: legs } = await client.query('SELECT * FROM bet_selections WHERE bet_id = $1', [betId]);
  if (legs.length === 0) return; // [].every(...) is true — never pay a bet that has no legs

  const active = legs.filter((l) => l.status !== 'VOID');
  let nextStatus;
  if (active.some((l) => l.status === 'LOST')) nextStatus = 'LOST';
  else if (active.length === 0) nextStatus = 'VOID';
  else if (active.every((l) => l.status === 'WON')) nextStatus = 'WON';
  else nextStatus = 'PENDING';

  if (nextStatus === bet.status) return;

  if (nextStatus === 'WON' && active.length < legs.length) {
    // Some legs were refunded: pay on the remaining legs only.
    const totalOdds = active.reduce((acc, l) => acc * Number(l.odds), 1);
    const payout = Number((Number(bet.stake) * totalOdds).toFixed(2));
    await client.query('UPDATE bets SET status = $1, total_odds = $2, potential_return = $3 WHERE id = $4', [nextStatus, totalOdds, payout, betId]);
    if (bet.status !== 'WON') await creditWithLedger(client, bet.user_id, payout, 'BET_WIN_PAYOUT', betId);
    return;
  }

  await client.query('UPDATE bets SET status = $1 WHERE id = $2', [nextStatus, betId]);
  if (nextStatus === 'WON' && bet.status !== 'WON') {
    await creditWithLedger(client, bet.user_id, bet.potential_return, 'BET_WIN_PAYOUT', betId);
  }
  if (nextStatus === 'VOID' && bet.status !== 'VOID') {
    await creditWithLedger(client, bet.user_id, bet.stake, 'BET_VOID_REFUND', betId);
  }
}

// Legs the rules above cannot decide stay PENDING for manual settlement. The real
// market names come from the provider, so log each distinct one once per process:
// that tells which markets people actually bet on that still have no rule.
const loggedUnrecognized = new Set();
function noteUnrecognizedMarket(leg) {
  const key = String(leg.market_name || leg.market_id || '?');
  if (loggedUnrecognized.has(key) || loggedUnrecognized.size >= 300) return;
  loggedUnrecognized.add(key);
  console.log('[settle] no auto rule for market "' + key + '" (selection "' + (leg.selection_name || leg.selection_id) + '") -- left PENDING for manual settlement');
}

// Given a final score, automatically settles every market whose winner is
// unambiguous from the final score alone (see determineLegOutcome): 1X2,
// double chance, draw-no-bet, over/under (match and team), BTTS, odd/even,
// correct score and whole/half-line handicaps. Anything else (half-time
// markets, combos, quarter handicaps) is left PENDING for manual review.
// Returns null if the match doesn't exist or is already settled (so callers
// — both the admin route and the automatic poller — never double-pay a bet);
// settleStuckBets() below is the safety net that re-checks leftovers.
export async function settleMatch(matchId, homeScore, awayScore, { force = false } = {}) {
  const client = await pool.connect();
  try {
    const { rows: matchRows } = await client.query('SELECT * FROM matches_cache WHERE id = $1', [matchId]);
    const match = matchRows[0];
    if (!match) return null;
    if (!force && match.status === 'FINISHED' && match.settled_at) return null; // already settled, don't redo

    const totalGoals = homeScore + awayScore;
    const bothScored = homeScore > 0 && awayScore > 0;
    const winner = homeScore > awayScore ? 'HOME' : awayScore > homeScore ? 'AWAY' : 'DRAW';

    const { rows: legs } = await client.query(
      `SELECT * FROM bet_selections WHERE match_id = $1 AND status = 'PENDING'`,
      [matchId]
    );

    const affectedBetIds = new Set();
    let autoSettledCount = 0;
    let leftPendingCount = 0;

    const stats = legs.some(legNeedsStats) ? await loadMatchStats(client, matchId) : undefined;
    const goalOrder = legs.some(legNeedsFirstScorer) ? await loadGoalOrder(client, match, homeScore, awayScore) : undefined;

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        affectedBetIds.add(leg.bet_id);
        const outcome = determineLegOutcome(leg, {
          winner, totalGoals, bothScored, homeScore, awayScore, stats, goalOrder,
          htHome: match.ht_home == null ? undefined : Number(match.ht_home),
          htAway: match.ht_away == null ? undefined : Number(match.ht_away),
        });

        if (outcome) {
          await client.query(`UPDATE bet_selections SET status = $1 WHERE id = $2 AND status = 'PENDING'`, [outcome, leg.id]);
          autoSettledCount++;
        } else {
          leftPendingCount++;
          noteUnrecognizedMarket(leg);
        }
      }

      await client.query(
        `UPDATE matches_cache SET status = 'FINISHED', result_home = $1, result_away = $2, settled_at = $3 WHERE id = $4`,
        [homeScore, awayScore, Date.now(), matchId]
      );

      for (const betId of affectedBetIds) await recomputeBetStatus(betId, client);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    return { autoSettledLegs: autoSettledCount, leftPendingForManualReview: leftPendingCount, affectedBets: affectedBetIds.size };
  } finally {
    client.release();
  }
}

// Safety net / verification pass. Walks every PENDING leg whose match is
// already FINISHED with a stored score and settles it from that score, then
// recomputes the affected tickets (and any ticket whose legs are all decided
// but whose own status is still PENDING). This is what closes tickets that
// were left "HAPUR" because settleMatch() had already run (and then refuses
// to run again) before the market type was understood, or a leg was missed.
// Idempotent: recomputeBetStatus locks the bet row and only pays on the
// transition into WON, so running it repeatedly never double-pays.
// A pending ticket is decided by its legs when it has a LOST leg, or no leg left PENDING.
export function ticketIsDecided(legStatuses) {
  return legStatuses.length > 0 && (legStatuses.includes('LOST') || !legStatuses.includes('PENDING'));
}

export async function findDecidedPendingTickets(client) {
  const { rows } = await client.query(
    `SELECT bs.bet_id, bs.status
       FROM bet_selections bs JOIN bets b ON b.id = bs.bet_id
      WHERE b.status = 'PENDING'`
  );
  const byBet = new Map();
  for (const r of rows) {
    if (!byBet.has(r.bet_id)) byBet.set(r.bet_id, []);
    byBet.get(r.bet_id).push(r.status);
  }
  return Array.from(byBet.entries()).filter(([, st]) => ticketIsDecided(st)).map(([id]) => id);
}

export async function settleStuckBets() {
  // Step 0: matches that were closed (FINISHED) WITHOUT being settled, so they have
  // no stored final score. Their last live score + clock is the best final score we
  // have; settleMatch() stores it and decides every leg. Only matches that really
  // had a score AND a running clock qualify (same guard as hasRealLiveResult in
  // london365.js) -- a match that never had live data is never settled on an
  // invented 0-0 and stays for the admin.
  let closedUnsettled = 0;
  try {
    const { rows: unsettled } = await pool.query(
      `SELECT DISTINCT m.id, m.live_home_score, m.live_away_score
         FROM matches_cache m
         JOIN bet_selections bs ON bs.match_id = m.id AND bs.status = 'PENDING'
        WHERE m.status = 'FINISHED'
          AND (m.result_home IS NULL OR m.result_away IS NULL)
          AND m.live_home_score IS NOT NULL AND m.live_away_score IS NOT NULL
          AND m.live_minute IS NOT NULL AND TRIM(m.live_minute::text) <> ''`
    );
    for (const m of unsettled) {
      try {
        const r = await settleMatch(m.id, Number(m.live_home_score), Number(m.live_away_score));
        if (r) closedUnsettled++;
      } catch (err) {
        console.error('[settle] could not settle closed match ' + m.id + ':', err.message);
      }
    }
  } catch (err) {
    console.error('[settle] closed-unsettled pass failed:', err.message);
  }

  const client = await pool.connect();
  try {
    const { rows: legs } = await client.query(
      `SELECT bs.*, m.result_home, m.result_away, m.ht_home, m.ht_away
         FROM bet_selections bs
         JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING'
          AND m.status = 'FINISHED'
          AND m.result_home IS NOT NULL AND m.result_away IS NOT NULL`
    );
    // Tickets whose legs already decide them but whose own status is still PENDING:
    // every leg decided, OR at least one leg LOST (an accumulator is lost the moment
    // one leg loses, whatever its other legs are doing). Without the LOST case a
    // ticket whose recompute was missed once stayed open for good.
    const undecided = (await findDecidedPendingTickets(client)).map((id) => ({ id }));

    const affectedBetIds = new Set(undecided.map((r) => r.id));
    let settledLegs = 0;
    const statsByMatch = new Map();
    const firstByMatch = new Map();
    for (const leg of legs) {
      if (legNeedsFirstScorer(leg) && !firstByMatch.has(leg.match_id)) {
        const { rows: mr } = await client.query('SELECT id, home_team, away_team FROM matches_cache WHERE id = $1', [leg.match_id]);
        firstByMatch.set(leg.match_id, mr[0] ? await loadGoalOrder(client, mr[0], Number(leg.result_home), Number(leg.result_away)) : undefined);
      }
      if (legNeedsStats(leg) && !statsByMatch.has(leg.match_id)) statsByMatch.set(leg.match_id, await loadMatchStats(client, leg.match_id));
    }

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        const home = Number(leg.result_home);
        const away = Number(leg.result_away);
        const outcome = determineLegOutcome(leg, {
          stats: statsByMatch.get(leg.match_id),
          goalOrder: firstByMatch.get(leg.match_id),
          winner: home > away ? 'HOME' : away > home ? 'AWAY' : 'DRAW',
          totalGoals: home + away,
          bothScored: home > 0 && away > 0,
          homeScore: home,
          awayScore: away,
          htHome: leg.ht_home == null ? undefined : Number(leg.ht_home),
          htAway: leg.ht_away == null ? undefined : Number(leg.ht_away),
        });
        if (!outcome) { noteUnrecognizedMarket(leg); continue; }
        await client.query(`UPDATE bet_selections SET status = $1 WHERE id = $2 AND status = 'PENDING'`, [outcome, leg.id]);
        affectedBetIds.add(leg.bet_id);
        settledLegs++;
      }
      for (const betId of affectedBetIds) await recomputeBetStatus(betId, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return { settledLegs, recomputedBets: affectedBetIds.size, closedUnsettled };
  } finally {
    client.release();
  }
}

// ---- recovery of matches closed without a stored result -----------------------
// The live socket can close a match (status FINISHED) without anything writing its
// result, and every other pass only settles matches that HAVE result_home/away --
// so those tickets sat open until the overdue sweep refunded them (a win became a
// refund). A score the provider really reported (score AND clock) is enough to
// settle once the match is plausibly over: its clock reached the end of normal
// time, or enough wall-clock time has passed since kickoff for it to be over.
// Anything weaker stays PENDING; nothing is settled on an invented or early score.
export const SETTLE_MIN_ELAPSED_MS = 105 * 60 * 1000;
const SETTLE_MIN_CLOCK_MINUTE = 88;

export function canSettleFromLiveScore(row, now = Date.now()) {
  if (!row) return false;
  const hasScore = row.live_home_score != null && row.live_away_score != null
    && Number.isInteger(Number(row.live_home_score)) && Number.isInteger(Number(row.live_away_score));
  const hasClock = row.live_minute != null && String(row.live_minute).trim() !== '';
  if (!hasScore || !hasClock) return false;
  const minute = minuteOf(row.live_minute);
  if (minute != null && minute >= SETTLE_MIN_CLOCK_MINUTE) return true;
  const kickoff = Date.parse(row.start_time);
  return Number.isFinite(kickoff) && now - kickoff >= SETTLE_MIN_ELAPSED_MS;
}

// Idempotent: a match that gets settled now has a result, so it is no longer a
// candidate; settleMatch itself refuses an already-settled match, and payouts are
// guarded per bet row (recomputeBetStatus). Safe to run on every sweep and at boot.
export async function recoverFinishedWithoutResult({ now = Date.now() } = {}) {
  const { rows } = await pool.query(
    `SELECT m.id, m.start_time, m.live_home_score, m.live_away_score, m.live_minute
       FROM matches_cache m
      WHERE m.status = 'FINISHED'
        AND m.result_home IS NULL AND m.result_away IS NULL
        AND m.live_home_score IS NOT NULL AND m.live_away_score IS NOT NULL
        AND EXISTS (SELECT 1 FROM bet_selections bs WHERE bs.match_id = m.id AND bs.status = 'PENDING')`
  );
  let settledMatches = 0;
  let notYetReliable = 0;
  let failed = 0;
  for (const row of rows) {
    if (!canSettleFromLiveScore(row, now)) { notYetReliable++; continue; }
    try {
      const result = await settleMatch(row.id, Number(row.live_home_score), Number(row.live_away_score));
      if (result) {
        settledMatches++;
        console.log('[settle] recovered ' + row.id + ' ' + row.live_home_score + '-' + row.live_away_score + ' ' + JSON.stringify(result));
      }
    } catch (err) {
      failed++;
      console.error('[settle] recovery of ' + row.id + ' failed (will retry next sweep):', err.message);
    }
  }
  return { recoverCandidates: rows.length, recoveredMatches: settledMatches, recoverNotYetReliable: notYetReliable, recoverFailed: failed };
}

// ---- closure guarantee ------------------------------------------------------
// A ticket is either still open because its match has not finished yet, or it is
// closed. It must never sit "HAPUR" for good. Two kinds of leg can still get stuck
// after everything above: a market no rule can decide (the provider's own naming,
// manual settlement never done) and a match that never produces a result
// (postponed, abandoned, dropped by the feed). Once the match is more than
// UNSETTLED_BET_VOID_AFTER_HOURS (default 24h) past kickoff, such a leg is VOIDed:
// it drops out of the ticket (a single bet is refunded, an accumulator is paid on
// its remaining legs) -- the same treatment a bookmaker gives a postponed match.
// 0 disables it. Admins can still settle any of these by hand before the deadline.
const UNSETTLED_VOID_AFTER_MS = Math.max(0, Number(process.env.UNSETTLED_BET_VOID_AFTER_HOURS ?? 24)) * 3600 * 1000;

export function isLegOverdue({ matchStart, betCreatedAt }, now, olderThanMs) {
  if (!(olderThanMs > 0)) return false;
  const start = Date.parse(matchStart);
  // No match row any more (cleaned up): fall back to when the ticket was placed.
  const ref = Number.isFinite(start) ? start : Number(betCreatedAt);
  return Number.isFinite(ref) && now - ref > olderThanMs;
}

export async function voidOverdueLegs({ olderThanMs = UNSETTLED_VOID_AFTER_MS, now = Date.now() } = {}) {
  if (!(olderThanMs > 0)) return { voidedLegs: 0, recomputedBets: 0, disabled: true };
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT bs.id, bs.bet_id, bs.match_id, bs.market_name, bs.selection_name,
              m.start_time AS match_start, b.created_at AS bet_created_at
         FROM bet_selections bs
         JOIN bets b ON b.id = bs.bet_id AND b.status = 'PENDING'
         LEFT JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING'`
    );
    const overdue = rows.filter((r) => isLegOverdue({ matchStart: r.match_start, betCreatedAt: r.bet_created_at }, now, olderThanMs));
    if (overdue.length === 0) return { voidedLegs: 0, recomputedBets: 0 };

    const betIds = new Set();
    await client.query('BEGIN');
    try {
      for (const leg of overdue) {
        await client.query(`UPDATE bet_selections SET status = 'VOID' WHERE id = $1 AND status = 'PENDING'`, [leg.id]);
        betIds.add(leg.bet_id);
      }
      for (const betId of betIds) await recomputeBetStatus(betId, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    for (const leg of overdue) {
      console.log('[settle] voided overdue leg (no result/rule ' + Math.round(olderThanMs / 3600000) + 'h after kickoff): match ' + leg.match_id + ' / "' + (leg.market_name || '?') + '" / "' + (leg.selection_name || '?') + '"');
    }
    return { voidedLegs: overdue.length, recomputedBets: betIds.size };
  } finally {
    client.release();
  }
}
