import pool from './db.js';
import { minuteOf, splitPeriod, PERIOD_BASE_ALIASES } from './marketPeriods.js';
import { extraMarketOutcome } from './extraMarkets.js';
import { asianHandicapOutcome, asianTotalOutcome } from './asianLines.js';
import { ticketOutcome } from './ticketOutcome.js';
import {
  goalCountOption, TOTAL_GOALS_PREFIXES, H2H_NAMES, BTTS_NAMES, DOUBLE_CHANCE_NAMES, CORRECT_SCORE_NAMES, HANDICAP_NAMES, parseOverUnder,
  STATS_UNDECIDABLE, EVENT_ORDER_RE, FIRST_TEAM_TO_SCORE_NAMES, LAST_TEAM_TO_SCORE_NAMES, FIRST_GOAL_NAMES, LAST_GOAL_NAMES, BOTH_HALVES_NAMES, GOAL_ORDER_NAMES, FIRST_GOAL_H1_NAMES,
  nextEventKind, CORNER_ORDINALS, isCornerRace, parseCornerRaceOption,
} from './marketRules.js';
import { parseProviderMarket, providerOutcome, goalTimelineFromRows } from './providerMarkets.js';

// ---- first / second half markets ------------------------------------------
// "Rezultati Pjesa e Parë", "Numri i Golave në Pjesën e Dytë", "1X2 1st Half" ...
// The period phrase is cut out of the (normalised) market name and what is left
// must be one of the known base markets, otherwise the leg stays PENDING for
// manual review (HT/FT doubles, "which half has more goals" etc. never match).
// First half uses the stored half-time score (matches_cache.ht_home/ht_away,
// captured at the whistle); second half is final score minus half-time score.
// (period phrases, name sets and Over/Under parsing live in marketPeriods.js / marketRules.js,
// shared with the betting rules so both sides always agree on what a market is.)

const HTFT_NAMES = new Set(['45/90', '45 / 90', '45/90 min', '45/90 minuta', 'pushim/fund', 'pushimi/fundi', 'pushim / fund', 'pushim fund', 'ht/ft', 'ht ft', 'pjesa e pare/finale', 'pjesa e pare/fund',
  'rezultati pjesa e pare / rezultati final', 'rezultati pjesa e pare/rezultati final', 'rezultati i pjeses se pare / rezultati final',
  'rezultati pjesa e pare / final', 'rezultati ne pushim / rezultati final']);

// "Rezultat Final & Totali" + "1 & Lart 2.5"  ->  two single legs. Only when market
// and selection split into the same number (2-3) of parts, otherwise not a combo.
function splitCombo(leg) {
  // the provider sometimes sends the HTML entity ("Rezultat Final &amp; Totali")
  const marketParts = String(leg.market_name || '').replace(/&amp;/g, '&').split(/\s*&\s*/);
  const selection = String(leg.selection_name || leg.selection_id || '').replace(/&amp;/g, '&');
  let selectionParts = selection.split(/\s*&\s*/);
  // Some markets write the parts of one combined selection with "/" or "_" instead of "&":
  // "Rezultat Final & Numri i Golave" -> "X/5+", "45/90 & Numri i Golave" -> "2-X/0-4" (or "X-2/3+"),
  // "Dopio Shans & Gol/JGol" -> "X2_Gol".
  if (marketParts.length >= 2 && selectionParts.length !== marketParts.length) {
    for (const sep of [/\s*\/\s*/, /\s*_\s*/]) {
      const parts = selection.split(sep);
      if (parts.length === marketParts.length) { selectionParts = parts; break; }
    }
  }
  // A half-time/full-time part written with a slash itself ("1/2") inside a slash-separated option
  // ("1/2/3+" for "45/90 & Numri i Golave"): put its two halves back together.
  if (marketParts.length >= 2 && selectionParts.length !== marketParts.length) {
    const slashed = selection.split(/\s*\/\s*/);
    const i = marketParts.findIndex((m) => HTFT_NAMES.has(norm(m)));
    if (i >= 0 && slashed.length === marketParts.length + 1) {
      selectionParts = [...slashed.slice(0, i), slashed[i] + '/' + slashed[i + 1], ...slashed.slice(i + 2)];
    }
  }
  if (marketParts.length < 2 || marketParts.length > 3 || marketParts.length !== selectionParts.length) return null;
  return marketParts.map((m, i) => ({
    ...leg,
    market_id: '',
    market_name: m.trim(),
    selection_id: selectionParts[i].trim(),
    selection_name: selectionParts[i].trim(),
  }));
}

// "Shtëpiaku" / "Udhëtuesi" are how the feed names the home / away side in team-total markets.
const HOME_SIDE_WORDS = ['shtepiaku', 'vendasi', 'shtepise', 'home', 'host'];
const AWAY_SIDE_WORDS = ['udhetuesi', 'mysafiri', 'mysafir', 'vizitori', 'vizitor', 'away', 'guest'];
// "0-4", "2-3" (inclusive) or "5+" -> [lo, hi]; anything else -> null
function goalCountRange(selection) {
  const o = goalCountOption(selection); // "0-4", "2-3", "5+" or exactly "2"
  return o ? [o.lo, o.hi] : null;
}

// "In which half will there be more corners / cards / goals": Pj1 | Pj2 | equal.
// First half from the half-time snapshot, second half = final minus half-time; PENDING otherwise.
function halfWithMoreOutcome(leg, kind, ctx) {
  const t = norm(leg.selection_name || leg.selection_id);
  const pick = /^(pj ?1|pjesa 1|pjesa e pare|pjesen e 1re|pjesen e pare|1st|1h|1)$/.test(t) ? 'H1'
    : /^(pj ?2|pjesa 2|pjesa e dyte|pjesen e 2te|pjesen e dyte|2nd|2h|2)$/.test(t) ? 'H2'
    : /^(x|barazim|baraz|njesoj|e njejta|equal|draw)$/.test(t) ? 'EQ' : null;
  if (!pick) return null;
  let h1; let h2;
  if (kind === 'goals') {
    const { homeScore: fh, awayScore: fa, htHome, htAway } = ctx;
    if (![fh, fa, htHome, htAway].every(Number.isFinite)) return null;
    h1 = htHome + htAway; h2 = fh + fa - h1;
  } else {
    const kh = kind + 'Home'; const ka = kind + 'Away';
    const fin = numOrNaN(ctx.stats && ctx.stats[kh]) + numOrNaN(ctx.stats && ctx.stats[ka]);
    h1 = numOrNaN(ctx.htStats && ctx.htStats[kh]) + numOrNaN(ctx.htStats && ctx.htStats[ka]);
    h2 = fin - h1;
  }
  if (!Number.isFinite(h1) || !Number.isFinite(h2) || h1 < 0 || h2 < 0) return null;
  const actual = h1 > h2 ? 'H1' : h2 > h1 ? 'H2' : 'EQ';
  return actual === pick ? 'WON' : 'LOST';
}

const STATS_MARKET = /korn|corner|karton|\bcards?\b|booking/;
const legNeedsStats = (leg) => STATS_MARKET.test(norm(leg.market_name));
const legNeedsFirstScorer = (leg) => GOAL_ORDER_NAMES.has(norm(leg.market_name)) || FIRST_GOAL_H1_NAMES.has(norm(leg.market_name)) || EVENT_ORDER_RE.test(norm(leg.market_name)) || isCornerRace(leg.market_name)
  || (splitCombo(leg) || []).some((p) => GOAL_ORDER_NAMES.has(norm(p.market_name)));

// Final corner / card counters of a match, or undefined if there are none (or the
// lookup fails -- the leg then simply stays PENDING).
async function loadMatchStats(client, matchId) {
  const pack = (r) => ({
    cornersHome: r.corners_home, cornersAway: r.corners_away, cardsHome: r.cards_home, cardsAway: r.cards_away,
    yellowHome: r.yellow_home, yellowAway: r.yellow_away, redHome: r.red_home, redAway: r.red_away,
  });
  try {
    const { rows } = await client.query(
      `SELECT corners_home, corners_away, cards_home, cards_away, yellow_home, yellow_away, red_home, red_away
         FROM live_statistics WHERE match_id = $1`, [matchId]);
    return rows[0] ? pack(rows[0]) : undefined;
  } catch {
    try { // yellow/red columns not migrated yet
      const { rows } = await client.query(
        'SELECT corners_home, corners_away, cards_home, cards_away FROM live_statistics WHERE match_id = $1', [matchId]);
      return rows[0] ? pack(rows[0]) : undefined;
    } catch { return undefined; }
  }
}

// Minutes of every goal of a finished match, ascending, or undefined when they cannot be trusted:
// the logged GOAL events must add up to the final score and each minute must have been read from
// the provider clock at the instant of the goal (minute_exact). 0-0 -> [].
async function loadGoalMinutes(client, matchId, homeScore, awayScore) {
  try {
    const total = homeScore + awayScore;
    if (total === 0) return [];
    const { rows } = await client.query(
      `SELECT minute, minute_exact FROM match_events WHERE match_id = $1 AND type = 'GOAL'`, [matchId]);
    if (rows.length !== total) return undefined;
    if (rows.some((r) => r.minute_exact !== true || r.minute == null || !Number.isFinite(Number(r.minute)))) return undefined;
    return rows.map((r) => Number(r.minute)).sort((a, b) => a - b);
  } catch { return undefined; }
}
const MINUTE_MARKET = /^minuta e gol(?:it|i)?(?: (?:te|i) (pare|fundit))?$/;
const legNeedsGoalMinutes = (leg) => MINUTE_MARKET.test(norm(leg.market_name))
  || (splitCombo(leg) || []).some((p) => MINUTE_MARKET.test(norm(p.market_name)));
const htStatsOf = (row) => (row.ht_corners_home == null && row.ht_cards_home == null && row.ht_red_home == null ? undefined
  : { cornersHome: row.ht_corners_home, cornersAway: row.ht_corners_away, cardsHome: row.ht_cards_home, cardsAway: row.ht_cards_away,
      redHome: row.ht_red_home, redAway: row.ht_red_away });
const numOrNaN = (v) => (v == null || v === '' ? NaN : Number(v)); // a missing counter is NOT 0

// "Minuta e Golit": selection is a minute range ("1-15", "76-90", "90+") or "no goal". Which goal
// the market means (first / last / any) is read from the name when it says so; a bare
// "Minuta e Golit" is decided only when first, last and any-goal readings all agree.
function minuteOutcome(leg, marketName, goalMinutes) {
  const mm = marketName.match(MINUTE_MARKET);
  if (!mm || !goalMinutes) return null;
  const text = norm(leg.selection_name || leg.selection_id);
  if (/^(pa gol|asnje|asnje gol|nuk ka gol|no goal|none)$/.test(text)) return goalMinutes.length === 0 ? 'WON' : 'LOST';
  let lo; let hi;
  let m = text.match(/^(\d+)\s*[-\u2013\u2014]\s*(\d+)(\+?)$/);
  if (m) { lo = Number(m[1]); hi = m[3] ? Infinity : Number(m[2]); } else {
    m = text.match(/^(\d+)\s*\+$/);
    if (!m) return null;
    lo = Number(m[1]); hi = Infinity;
  }
  if (goalMinutes.length === 0) return 'LOST';
  const inR = (x) => x >= lo && x <= hi;
  const first = inR(goalMinutes[0]);
  const last = inR(goalMinutes[goalMinutes.length - 1]);
  const readings = mm[1] === 'pare' ? [first] : mm[1] === 'fundit' ? [last] : [first, last, goalMinutes.some(inR)];
  if (readings.every(Boolean)) return 'WON';
  if (!readings.some(Boolean)) return 'LOST';
  return null;
}

// Goal order of a finished match: { first, last } each 'HOME' | 'AWAY' | 'NONE' (0-0), or
// undefined when it cannot be trusted. The logged GOAL events (recordGoalIfChanged) are used
// only if they add up to the final score for each team (a match first seen at 2-1 or a server
// gap leaves events missing); a first/last goal tied in time with a goal of the other team is
// not trusted either.
async function loadGoalOrder(client, match, homeScore, awayScore) {
  try {
    const { rows } = await client.query(
      `SELECT team, created_at FROM match_events WHERE match_id = $1 AND type = 'GOAL' ORDER BY created_at, id`, [match.id]);
    const order = homeScore + awayScore === 0
      ? { first: 'NONE', second: 'NONE', last: 'NONE' }
      : goalOrderFromEvents(rows, match.home_team, match.away_team, homeScore, awayScore);
    // corner / card order: only when the logged events add up to the final counters of each side
    const st = await loadMatchStats(client, match.id);
    const sideOrder = async (types, nHome, nAway) => {
      const { rows: ev } = await client.query(
        `SELECT team, created_at FROM match_events WHERE match_id = $1 AND type = ANY($2) ORDER BY created_at, id`, [match.id, types]);
      return sideOrderFromEvents(ev, nHome, nAway);
    };
    const { rows: cornerLog } = await client.query(
      `SELECT team, created_at FROM match_events WHERE match_id = $1 AND type = 'CORNER' ORDER BY created_at, id`, [match.id]);
    return {
      ...(order || {}),
      cornerLog, // every corner event in order: "Gara e Korneve" and "Godet kornen e N-te"
      corner: st ? await sideOrder(['CORNER'], numOrNaN(st.cornersHome), numOrNaN(st.cornersAway)) : undefined,
      card: st ? await sideOrder(['YELLOW_CARD', 'RED_CARD'], numOrNaN(st.cardsHome), numOrNaN(st.cardsAway)) : undefined,
    };
  } catch { return undefined; }
}

// { first, last } sides ('HOME' | 'AWAY') of corner / card events logged as 'home' / 'away', or undefined
// when the log does not add up to the final counters (events missed while the server was down) or the
// first / last event is tied in time with one of the other side. No events at all -> 'NONE'.
export function sideOrderFromEvents(events, nHome, nAway) {
  if (!Number.isFinite(nHome) || !Number.isFinite(nAway)) return undefined;
  if (nHome + nAway === 0) return { first: 'NONE', last: 'NONE' };
  if (events.filter((e) => e.team === 'home').length !== nHome || events.filter((e) => e.team === 'away').length !== nAway) return undefined;
  const side = (e) => (e.team === 'home' ? 'HOME' : e.team === 'away' ? 'AWAY' : undefined);
  const pick = (e) => (events.some((o) => o.team !== e.team && Number(o.created_at) === Number(e.created_at)) ? undefined : side(e));
  return { first: pick(events[0]), last: pick(events[events.length - 1]) };
}

// Side of the Nth corner of the match ('HOME' | 'AWAY'), 'NONE' when there were fewer than N corners, or
// undefined when the log cannot be trusted (it must add up to the final counters; the Nth event must not be
// tied in time with an event of the other side).
export function nthEventSide(events, nHome, nAway, n) {
  if (!Array.isArray(events) || !Number.isFinite(nHome) || !Number.isFinite(nAway) || !Number.isFinite(n) || n < 1) return undefined;
  if (events.filter((e) => e.team === 'home').length !== nHome || events.filter((e) => e.team === 'away').length !== nAway) return undefined;
  if (events.length < n) return 'NONE';
  const e = events[n - 1];
  if (events.some((o) => o.team !== e.team && Number(o.created_at) === Number(e.created_at))) return undefined;
  return e.team === 'home' ? 'HOME' : e.team === 'away' ? 'AWAY' : undefined;
}

// "Gara e Korneve": the team that reached N corners first. Decided by the counters alone unless BOTH
// teams reached N; then the logged corner order decides (the log must add up to the counters, and the
// two Nth corners must not share a timestamp). 'NONE' when neither reached N.
export function raceWinnerFromEvents(events, n, nHome, nAway) {
  if (![n, nHome, nAway].every(Number.isFinite) || n < 1) return undefined;
  if (nHome < n && nAway < n) return 'NONE';
  if (nHome >= n && nAway < n) return 'HOME';
  if (nAway >= n && nHome < n) return 'AWAY';
  if (!Array.isArray(events)) return undefined;
  if (events.filter((e) => e.team === 'home').length !== nHome || events.filter((e) => e.team === 'away').length !== nAway) return undefined;
  let h = 0; let a = 0; let hitHome = null; let hitAway = null;
  for (const e of events) {
    if (e.team === 'home') { h += 1; if (h === n) hitHome = Number(e.created_at); } else if (e.team === 'away') { a += 1; if (a === n) hitAway = Number(e.created_at); }
  }
  if (!Number.isFinite(hitHome) || !Number.isFinite(hitAway) || hitHome === hitAway) return undefined;
  return hitHome < hitAway ? 'HOME' : 'AWAY';
}

function cornerRaceOutcome(leg, stats, cornerLog) {
  const opt = parseCornerRaceOption(leg.selection_name || leg.selection_id, leg.match_home, leg.match_away);
  if (!opt || !stats) return null;
  const winner = raceWinnerFromEvents(cornerLog, opt.n, numOrNaN(stats.cornersHome), numOrNaN(stats.cornersAway));
  if (!winner) return null; // order not reliable: stays PENDING
  return winner === opt.side ? 'WON' : 'LOST';
}

// An event logged less than this long after the bet may really have happened just before it (feed
// delay), so a "next ..." ticket decided by it is not settled automatically.
export const NEXT_EVENT_GRACE_MS = 3000;

// Events of one kind as { side, created_at }, plus whether the log adds up to the final counters of
// each side (a match first seen late, or a server gap, leaves events missing).
export function nextEventPack(events, homeTeam, awayTeam, nHome, nAway) {
  if (!Number.isFinite(nHome) || !Number.isFinite(nAway)) return undefined;
  const sideOf = (e) => (e.team === 'home' || e.team === homeTeam ? 'HOME' : e.team === 'away' || e.team === awayTeam ? 'AWAY' : undefined);
  const evs = (events || []).map((e) => ({ side: sideOf(e), created_at: Number(e.created_at) })).filter((e) => e.side);
  const count = (side) => evs.filter((e) => e.side === side).length;
  return { events: evs, complete: count('HOME') === nHome && count('AWAY') === nAway, nHome, nAway };
}

// Side of the first event logged after the bet: 'HOME' | 'AWAY' | 'NONE' (no more of them), or
// undefined when that cannot be trusted.
export function sideAfterBet(pack, placedAt, snap) {
  if (!pack || !Number.isFinite(placedAt) || placedAt <= 0) return undefined;
  const after = pack.events.filter((e) => e.created_at > placedAt);
  const tied = (first) => after.some((o) => o.side !== first.side && o.created_at === first.created_at);
  // Counters at the moment of the bet are known: only the events AFTER it have to add up
  // (counter now - counter at the bet, per side), whatever happened earlier in the match.
  if (snap && [snap.home, snap.away, pack.nHome, pack.nAway].every(Number.isFinite)) {
    const dHome = pack.nHome - snap.home;
    const dAway = pack.nAway - snap.away;
    if (dHome < 0 || dAway < 0) return undefined; // a counter went down (VAR / correction)
    if (after.filter((e) => e.side === 'HOME').length !== dHome || after.filter((e) => e.side === 'AWAY').length !== dAway) return undefined;
    if (!after.length) return 'NONE';
    return tied(after[0]) ? undefined : after[0].side;
  }
  // Older tickets (no snapshot): the whole log must add up, and an event right after the bet may
  // really predate it.
  if (!pack.complete) return undefined;
  if (!after.length) return 'NONE';
  if (after[0].created_at - placedAt < NEXT_EVENT_GRACE_MS) return undefined;
  return tied(after[0]) ? undefined : after[0].side;
}

// Counter of one kind per side right now ({ home, away }), stored with the ticket at placement.
export async function readNextEventCounters(client, matchId, kind) {
  try {
    if (kind === 'goal') {
      const { rows } = await client.query('SELECT live_home_score, live_away_score FROM matches_cache WHERE id = $1', [matchId]);
      const home = Number(rows[0] && rows[0].live_home_score); const away = Number(rows[0] && rows[0].live_away_score);
      return rows[0] && rows[0].live_home_score != null && rows[0].live_away_score != null && Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
    }
    const st = await loadMatchStats(client, matchId);
    if (!st) return null;
    const home = numOrNaN(kind === 'corner' ? st.cornersHome : st.cardsHome);
    const away = numOrNaN(kind === 'corner' ? st.cornersAway : st.cardsAway);
    return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
  } catch { return null; }
}
// Live corner counters for the in-play corner totals markets: { home, away, fresh }.
// `fresh` = the live feed touched live_statistics within maxAgeMs (the gamedetails heartbeat keeps it
// moving while the feed delivers), so a dead feed never lets a bet through on a frozen count.
export async function readLiveCorners(client, matchId, now = Date.now(), maxAgeMs = 60000) {
  try {
    const { rows } = await client.query('SELECT corners_home, corners_away, updated_at FROM live_statistics WHERE match_id = $1', [matchId]);
    const r = rows[0];
    if (!r) return null;
    const home = numOrNaN(r.corners_home); const away = numOrNaN(r.corners_away);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
    const at = Number(r.updated_at);
    return { home, away, fresh: Number.isFinite(at) && now - at <= maxAgeMs };
  } catch { return null; }
}
// Live card counters (yellow + red per team, as the feed counts them) for the in-play card totals markets:
// { home, away, fresh }. Same freshness rule as readLiveCorners.
export async function readLiveCards(client, matchId, now = Date.now(), maxAgeMs = 60000) {
  try {
    let r;
    try { // yellow / red columns are newer than cards_*: an old database only has the totals
      ({ rows: [r] } = await client.query('SELECT cards_home, cards_away, yellow_home, yellow_away, red_home, red_away, updated_at FROM live_statistics WHERE match_id = $1', [matchId]));
    } catch {
      ({ rows: [r] } = await client.query('SELECT cards_home, cards_away, updated_at FROM live_statistics WHERE match_id = $1', [matchId]));
    }
    if (!r) return null;
    const home = numOrNaN(r.cards_home); const away = numOrNaN(r.cards_away);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
    const at = Number(r.updated_at);
    return {
      home, away, fresh: Number.isFinite(at) && now - at <= maxAgeMs,
      // split by colour (NaN when the feed never delivered it: a missing value never counts as 0)
      yellowHome: numOrNaN(r.yellow_home), yellowAway: numOrNaN(r.yellow_away), redHome: numOrNaN(r.red_home), redAway: numOrNaN(r.red_away),
    };
  } catch { return null; }
}
const legSnapshot = (leg) => {
  let c = leg.placed_counts;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = null; } }
  return c && Number.isFinite(Number(c.home)) && Number.isFinite(Number(c.away)) ? { home: Number(c.home), away: Number(c.away) } : undefined;
};

async function loadNextEvents(client, match, homeScore, awayScore) {
  try {
    const q = async (types) => (await client.query(
      `SELECT team, created_at FROM match_events WHERE match_id = $1 AND type = ANY($2) ORDER BY created_at, id`, [match.id, types])).rows;
    const st = await loadMatchStats(client, match.id);
    return {
      goal: nextEventPack(await q(['GOAL']), match.home_team, match.away_team, homeScore, awayScore),
      corner: st ? nextEventPack(await q(['CORNER']), match.home_team, match.away_team, numOrNaN(st.cornersHome), numOrNaN(st.cornersAway)) : undefined,
      card: st ? nextEventPack(await q(['YELLOW_CARD', 'RED_CARD']), match.home_team, match.away_team, numOrNaN(st.cardsHome), numOrNaN(st.cardsAway)) : undefined,
    };
  } catch { return undefined; }
}
const legNeedsNextEvent = (leg) => Boolean(nextEventKind(leg.market_name));
// Goal-by-goal timeline (minute + side) for "goal before minute N" and "RF-N" markets.
async function loadGoalTimeline(client, match, homeScore, awayScore) {
  try {
    if (homeScore + awayScore === 0) return [];
    const { rows } = await client.query(`SELECT team, minute, minute_exact FROM match_events WHERE match_id = $1 AND type = 'GOAL'`, [match.id]);
    return goalTimelineFromRows(rows, match.home_team, match.away_team, homeScore, awayScore);
  } catch { return undefined; }
}
const legNeedsTimeline = (leg) => { const p = parseProviderMarket(norm(leg.market_name)); return Boolean(p && (p.type === 'goal_before' || p.type === 'rf_at')); };

// "Next goal / corner / card" tickets are decided the moment the next such event happens after the
// bet (not when the match ends): the first event logged after the bet decides every ticket on it.
// Runs on a short timer (server.js). A ticket is only decided from a complete, untied event log
// (see nextEventPack / sideAfterBet); otherwise it waits and is tried again, and at full time
// settleMatch() settles whatever is left ("no more events" included).
export async function settleNextEventLegs() {
  let decided = 0;
  const { rows } = await pool.query(
    `SELECT bs.*, m.home_team AS m_home, m.away_team AS m_away, m.live_home_score AS m_live_home, m.live_away_score AS m_live_away
       FROM bet_selections bs JOIN matches_cache m ON m.id = bs.match_id
      WHERE bs.status = 'PENDING' AND bs.placed_at IS NOT NULL AND m.result_home IS NULL
        AND (bs.market_name ILIKE '%radh%' OR bs.market_name ILIKE '%next%')`);
  const legs = rows.filter(legNeedsNextEvent);
  const byMatch = new Map();
  for (const l of legs) byMatch.set(l.match_id, [...(byMatch.get(l.match_id) || []), l]);
  for (const [matchId, list] of byMatch) {
    const first = list[0];
    const hs = Number(first.m_live_home); const as = Number(first.m_live_away);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const packs = await loadNextEvents(pool, { id: matchId, home_team: first.m_home, away_team: first.m_away }, hs, as);
    if (!packs) continue;
    for (const leg of list) {
      const actual = sideAfterBet(packs[nextEventKind(leg.market_name)], Number(leg.placed_at), legSnapshot(leg));
      if (actual !== 'HOME' && actual !== 'AWAY') continue; // nothing after the bet yet / not trustworthy yet
      const sel = norm(leg.selection_name || leg.selection_id);
      const side = /^(asnje|asnje gol|asnje korner|asnje karton|no goal|none|pa gol)$/.test(sel) ? 'DRAW' : sideOfSelection(leg);
      if (side !== 'HOME' && side !== 'AWAY' && side !== 'DRAW') continue;
      const outcome = side === actual ? 'WON' : 'LOST';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(`UPDATE bet_selections SET status = $1 WHERE id = $2 AND status = 'PENDING'`, [outcome, leg.id]);
        if (res.rowCount) await recomputeBetStatus(leg.bet_id, client);
        await client.query('COMMIT');
        decided += res.rowCount;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[settle] next-event leg ' + leg.id + ' failed:', err.message);
      } finally {
        client.release();
      }
    }
  }
  return { decided };
}

export function goalOrderFromEvents(events, homeTeam, awayTeam, homeScore, awayScore) {
  if (homeScore + awayScore === 0) return { first: 'NONE', second: 'NONE', last: 'NONE' };
  const nHome = events.filter((e) => e.team === homeTeam).length;
  const nAway = events.filter((e) => e.team === awayTeam).length;
  if (nHome !== homeScore || nAway !== awayScore || !events.length) return undefined;
  const side = (e) => (e.team === homeTeam ? 'HOME' : e.team === awayTeam ? 'AWAY' : undefined);
  const pick = (e) => (events.some((o) => o.team !== e.team && Number(o.created_at) === Number(e.created_at)) ? undefined : side(e));
  return { first: pick(events[0]), second: events.length >= 2 ? pick(events[1]) : 'NONE', last: pick(events[events.length - 1]) };
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
  // Quarter lines (2.25, 2.75) split the stake over the two neighbouring lines: a total landing
  // on one of them is a half win / half loss (the ticket model pays HALF_WON / HALF_LOST).
  if ((point * 2) % 1 !== 0) return side === 'Over' || side === 'Under' ? asianTotalOutcome(side === 'Over', point, goals) : null;
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
  if (Number.isNaN(point) || Math.abs(point * 4 - Math.round(point * 4)) > 1e-9) return null; // not a multiple of 0.25
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
  // red-only / yellow-only card markets use their own counters; plain card markets yellow+red.
  const kind = isCorners ? 'corners' : /\bkuq\b|\bred\b/.test(marketName) ? 'red' : /\bverdh|\byellow\b/.test(marketName) ? 'yellow' : 'cards';
  const h = numOrNaN(stats[kind + 'Home']);
  const a = numOrNaN(stats[kind + 'Away']);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  let total = h + a;
  const rest = marketName.replace(/p1\s*\+\s*p2/g, '');
  // the team name must appear as whole words ("Shuma total e korneve" must not match a team called "A")
  const hasWord = (team) => new RegExp('(^|[^a-z0-9])' + String(team).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(rest);
  if (home && hasWord(home)) total = h;
  else if (away && hasWord(away)) total = a;
  else if (/\b(skuadra|team)\b|\b1\b|\b2\b/.test(rest) && !/\b(shuma|totali|total)\b/.test(rest)) return null; // team market we cannot attribute
  const text = norm(leg.selection_name || leg.selection_id);
  const ou = parseOverUnder(leg.selection_id) || parseOverUnder(leg.selection_name);
  if (ou) return overUnderOutcome(ou.side, ou.point, total);
  let m = text.match(/^sakte\s+(\d+)$/); // "Sakte 10" = exactly 10 (Lart/Poshtë Korne Totali)
  if (m) return total === Number(m[1]) ? 'WON' : 'LOST';
  m = text.match(/^(\d+)\s*\+$/); // "5+" = at least 5
  if (m) return total >= Number(m[1]) ? 'WON' : 'LOST';
  m = text.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/); // "3-5"
  if (m) return total >= Number(m[1]) && total <= Number(m[2]) ? 'WON' : 'LOST';
  if ((kind === 'red' || kind === 'yellow') && /^(po|yes|jo|no)$/.test(text)) { // "Karton i kuq" Po/Jo
    const yes = text === 'po' || text === 'yes';
    return (total > 0) === yes ? 'WON' : 'LOST';
  }
  return null; // any other label has no agreed meaning: manual
}

// "Shuma e korneve P1+P2" with selection "5+|6+": at least 5 corners in the first half AND at
// least 6 in the second (each side is "N+" or "N-M"). Needs the half-time counter snapshot.
function cornersP1P2Outcome(leg, stats, htStats) {
  const text = norm(leg.selection_name || leg.selection_id);
  const part = (t) => {
    let m = t.trim().match(/^(\d+)\s*\+$/);
    if (m) return [Number(m[1]), Infinity];
    m = t.trim().match(/^(\d+)\s*[-\u2013\u2014]\s*(\d+)$/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const halves = text.split('|');
  if (halves.length !== 2) return null;
  const r1 = part(halves[0]); const r2 = part(halves[1]);
  if (!r1 || !r2 || !stats || !htStats) return null;
  const fin = numOrNaN(stats.cornersHome) + numOrNaN(stats.cornersAway);
  const ht = numOrNaN(htStats.cornersHome) + numOrNaN(htStats.cornersAway);
  if (!Number.isFinite(fin) || !Number.isFinite(ht) || ht < 0 || fin < ht) return null;
  const c1 = ht; const c2 = fin - ht;
  return c1 >= r1[0] && c1 <= r1[1] && c2 >= r2[0] && c2 <= r2[1] ? 'WON' : 'LOST';
}

export function determineLegOutcome(leg, { winner, totalGoals, bothScored, homeScore, awayScore, htHome, htAway, stats, htStats, goalOrder, goalMinutes, nextEvents, goalTimeline }) {
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

  // ---- the provider's less common markets (clean sheet, win either half, half goals, ...) ----
  const extra = extraMarketOutcome(leg, marketName, { homeScore, awayScore, htHome, htAway, stats, htStats });
  if (extra !== undefined) return extra;

  // ---- combination markets: "Rezultat Final & Totali" -> "1 & Lart 2.5" ----
  // Every part must win. One part that LOSES decides the whole bet at once, even
  // if another part is not understood; otherwise all parts must be understood and
  // won. A refunded (VOID) part is left for manual review: its payout rule differs.
  const combo = splitCombo(leg);
  if (combo) {
    const outcomes = combo.map((sub) => determineLegOutcome(sub, { winner, totalGoals, bothScored, homeScore, awayScore, htHome, htAway, stats, htStats, goalOrder, goalMinutes, nextEvents }));
    if (outcomes.includes('LOST')) return 'LOST';
    if (outcomes.every((o) => o === 'WON')) return 'WON';
    return null;
  }

  // ---- corners per half: "Shuma e korneve P1+P2" -> "5+|6+" ----
  if (/korn|corner/.test(marketName) && /p1\s*\+\s*p2/.test(marketName) && String(leg.selection_name || leg.selection_id).includes('|')) {
    return cornersP1P2Outcome(leg, stats, htStats);
  }

  // ---- "Minuta e Golit" ----
  if (MINUTE_MARKET.test(marketName)) return minuteOutcome(leg, marketName, goalMinutes);

  // ---- "Në cilën pjesë do bëhen më shumë korne / karton / gola" ----
  if (/\bne cilen pjese\b|\bpjesa me (me )?shume\b/.test(marketName)) {
    const kind = /korn|corner/.test(marketName) ? 'corners' : /karton|\bcards?\b/.test(marketName) ? 'cards' : /gol/.test(marketName) ? 'goals' : null;
    if (kind) return halfWithMoreOutcome(leg, kind, { homeScore, awayScore, htHome, htAway, stats, htStats });
  }

  // ---- half-time / full-time double: "Pushim/Fund" -> "1/2" ----
  if (HTFT_NAMES.has(marketName)) {
    const m = String(leg.selection_name || leg.selection_id).trim().toLowerCase().match(/^([12x])\s*[\/-]\s*([12x])$/);
    if (!m || !hasScore || !Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
    const sign = (h, a) => (h > a ? '1' : a > h ? '2' : 'x');
    return sign(htHome, htAway) === m[1] && sign(homeScore, awayScore) === m[2] ? 'WON' : 'LOST';
  }

  // First goal of the first half: no goal before the break -> "None 1"; otherwise the first goal of the
  // match IS the first goal of the half, so its scorer decides ("1 1" home, "2 1" away).
  if (FIRST_GOAL_H1_NAMES.has(marketName)) {
    if (!Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
    const sel = norm(leg.selection_name || leg.selection_id);
    const actual = htHome + htAway === 0 ? 'NONE' : goalOrder && (goalOrder.first === 'HOME' || goalOrder.first === 'AWAY') ? goalOrder.first : null;
    if (!actual) return null; // goal order not reliable: stays PENDING
    const picked = sel === 'none 1' ? 'NONE' : sel === '1 1' ? 'HOME' : sel === '2 1' ? 'AWAY' : null;
    return picked ? (picked === actual ? 'WON' : 'LOST') : null;
  }
  // ---- "Goli / Korneri / Karton i radhës": the side of the first such event AFTER the bet ----
  const nextKind = nextEventKind(marketName);
  if (nextKind) {
    const actual = sideAfterBet(nextEvents && nextEvents[nextKind], leg.placed_at == null ? NaN : Number(leg.placed_at), legSnapshot(leg));
    if (!actual) return null; // log incomplete / bet time unknown / too close to the bet: stays PENDING
    const sel = norm(leg.selection_name || leg.selection_id);
    const side = /^(asnje|asnje gol|asnje korner|asnje karton|no goal|none|pa gol)$/.test(sel) ? 'DRAW' : sideOfSelection(leg);
    if (side !== 'HOME' && side !== 'AWAY' && side !== 'DRAW') return null;
    return (side === 'DRAW' ? 'NONE' : side) === actual ? 'WON' : 'LOST';
  }

  // ---- the provider's own markets: team goals, scores in P2, result & BTTS, goal before minute N, RF-N ----
  const pm = parseProviderMarket(marketName);
  if (pm && pm.type !== 'result_goals') {
    return providerOutcome(pm, norm(leg.selection_name || leg.selection_id), { homeScore, awayScore, htHome, htAway, goalTimeline }) ?? null;
  }

  const { period, base } = splitPeriod(marketName);
  if (period) {
    // Needs the half-time score; without it (e.g. the server was down at HT) the
    // leg is left PENDING rather than guessed.
    // Corner / card markets of one half: first half = counters at the whistle, second half =
    // final counters minus those (only when both snapshots exist and are consistent).
    if (STATS_MARKET.test(base)) {
      if (!stats || !htStats) return null;
      const f = (k) => [numOrNaN(stats[k]), numOrNaN(htStats[k])];
      const pairs = ['cornersHome', 'cornersAway', 'cardsHome', 'cardsAway'].map((k) => [k, ...f(k)]);
      const periodStats = {};
      for (const [k, fin, ht] of pairs) {
        if (!Number.isFinite(fin) || !Number.isFinite(ht) || ht < 0 || fin < ht) { periodStats[k] = NaN; continue; }
        periodStats[k] = period === 'H1' ? ht : fin - ht;
      }
      return statsOutcome({ ...leg, market_id: '' }, base, periodStats, { home: leg.match_home && norm(leg.match_home), away: leg.match_away && norm(leg.match_away) });
    }
    if (!hasScore || !Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
    const h = period === 'H1' ? htHome : homeScore - htHome;
    const a = period === 'H1' ? htAway : awayScore - htAway;
    if (h < 0 || a < 0) return null;
    return determineLegOutcome(
      { ...leg, market_id: '', market_name: PERIOD_BASE_ALIASES[base] || base },
      { winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0, homeScore: h, awayScore: a }
    );
  }
  // first / last corner, first card, second goal: side selections (1 / 2) from the logged event order
  if (isCornerRace(marketName)) return cornerRaceOutcome(leg, stats, goalOrder && goalOrder.cornerLog);
  const eo = marketName.match(EVENT_ORDER_RE);
  if (eo) {
    const nthWord = (eo[1].match(/^godet kornen e (\w+)$/) || [])[1];
    const nth = nthWord && nthWord !== 'fundit' && nthWord !== 'pare' ? CORNER_ORDINALS[nthWord] : null; // "the Nth corner of the match" (first / last keep their own logic)
    const key = nth ? ['corner', 'nth'] : eo[1] === 'godet kornen e pare' ? ['corner', 'first'] : eo[1] === 'godet kornen e fundit' ? ['corner', 'last']
      : eo[1] === 'merr kartonin e pare' ? ['card', 'first'] : ['goal', 'second'];
    const actual = nth
      ? (stats && goalOrder ? nthEventSide(goalOrder.cornerLog, numOrNaN(stats.cornersHome), numOrNaN(stats.cornersAway), nth) : undefined)
      : key[0] === 'goal' ? goalOrder && goalOrder.second : goalOrder && goalOrder[key[0]] && goalOrder[key[0]][key[1]];
    const side = sideOfSelection(leg);
    // "X" / "no ..." options have no confirmed meaning, and with no such event at all there is nothing to decide
    if (!actual || actual === 'NONE' || (side !== 'HOME' && side !== 'AWAY')) return null;
    return side === actual ? 'WON' : 'LOST';
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
    if (/^(asnje|asnje gol|no goal|none|pa gol|s'ka gol|ska gol|x)$/.test(sel)) return actual === 'NONE' ? 'WON' : 'LOST';
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
    // the provider's "Gol Jo Gol Live" / "Gol / Jo Gol Ne P2" label the options 1 = Gol, 2 = Jo Gol
    const numeric = marketName === 'gol jo gol live';
    const tight = sel.replace(/[\s_-]/g, ''); // "Jo Gol", "J_Gol", "JGol" ...
    if (sel === 'po' || sel === 'yes' || sel === 'gol' || (numeric && sel === '1')) return bothScored ? 'WON' : 'LOST';
    if (sel === 'jo' || sel === 'no' || tight === 'jogol' || tight === 'jgol' || tight === 'nogoal' || (numeric && sel === '2')) return !bothScored ? 'WON' : 'LOST';
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
    const range = goalCountRange(leg.selection_name || leg.selection_id); // "0-4", "2-3", "5+"
    if (range) return totalGoals >= range[0] && totalGoals <= range[1] ? 'WON' : 'LOST';
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

  // Team-specific total goals: "<prefix> <team name>" or "<prefix> Shtëpiaku / Udhëtuesi"
  for (const prefix of TOTAL_GOALS_PREFIXES) {
    for (const [team, words, goals] of [[leg.match_home, HOME_SIDE_WORDS, homeScore], [leg.match_away, AWAY_SIDE_WORDS, awayScore]]) {
      const names = [...(team ? [norm(team)] : []), ...words];
      if (names.some((n) => marketName === `${prefix} ${n}`)) {
        const parsed = parseOverUnder(leg.selection_id) || parseOverUnder(leg.selection_name);
        if (parsed) return overUnderOutcome(parsed.side, parsed.point, goals);
      }
    }
  }

  // Handicap (whole / half lines only)
  if (HANDICAP_NAMES.has(marketName) || marketId.endsWith('-spreads')) {
    const h = parseHandicap(leg);
    if (!h) return null;
    return h.side === 'HOME' ? asianHandicapOutcome(homeScore, awayScore, h.point) : asianHandicapOutcome(awayScore, homeScore, h.point);
  }

  return null;
}

// Credits a user's balance for a settled ticket AND records it in the transactions ledger,
// in the caller's transaction (the bet row is already locked). Stake deductions and cancel
// refunds were already ledgered; settlement payouts and void refunds were not, so a balance
// could change with no trace. A failed ledger write fails (and rolls back) the whole
// settlement, which the sweeps then retry: money must never move without a record.
// type: 'BET_WIN_PAYOUT' | 'BET_VOID_REFUND'; reference: the bet id.
async function creditWithLedger(client, userId, amount, type, betId, currency = 'ALL') {
  const col = currency === 'EUR' ? 'balance_eur' : 'balance';
  const { rows } = await client.query(`SELECT ${col} FROM users WHERE id = $1 FOR UPDATE`, [userId]);
  if (!rows[0]) return; // user no longer exists: nothing to credit
  const before = Number(rows[0][col]);
  const after = Math.round((before + Number(amount)) * 100) / 100;
  await client.query(`UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`, [amount, userId]);
  await client.query(
    `INSERT INTO transactions
      (actor_id, source_id, target_id, amount, type, reference,
       source_balance_before, source_balance_after, target_balance_before, target_balance_after, created_at, currency)
     VALUES ($1,$1,$1,$2,$3,$4,$5,$6,$5,$6,$7,$8)`,
    [userId, amount, type, betId, before, after, Date.now(), currency === 'EUR' ? 'EUR' : 'ALL']
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
  if (bet.status === 'CANCELLED') return; // cancelled by an admin: stake already put back, never settle or pay it
  const { rows: legs } = await client.query('SELECT * FROM bet_selections WHERE bet_id = $1', [betId]);
  if (legs.length === 0) return; // [].every(...) is true — never pay a bet that has no legs

  const outcome = ticketOutcome(bet.stake, legs);
  const nextStatus = outcome.status;

  if (nextStatus === bet.status) return;

  if (nextStatus === 'WON' && outcome.payout != null) {
    // Some legs were refunded and/or half won / half lost: pay what the legs are really worth.
    await client.query('UPDATE bets SET status = $1, total_odds = $2, potential_return = $3 WHERE id = $4', [nextStatus, outcome.totalOdds, outcome.payout, betId]);
    if (bet.status !== 'WON') await creditWithLedger(client, bet.user_id, outcome.payout, 'BET_WIN_PAYOUT', betId, bet.currency);
    return;
  }

  await client.query('UPDATE bets SET status = $1 WHERE id = $2', [nextStatus, betId]);
  if (nextStatus === 'WON' && bet.status !== 'WON') {
    await creditWithLedger(client, bet.user_id, bet.potential_return, 'BET_WIN_PAYOUT', betId, bet.currency);
  }
  if (nextStatus === 'VOID' && bet.status !== 'VOID') {
    await creditWithLedger(client, bet.user_id, bet.stake, 'BET_VOID_REFUND', betId, bet.currency);
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
// The score markets are settled on: the one at the end of regular time. Captured when the match
// entered extra time (rt_home / rt_away); without it, the goals logged in extra time (half = 3) are
// taken off the final score. Never above the live score (a goal can be cancelled by VAR).
export function regularTimeScoreFrom(match, extraGoals, home, away) {
  if (match && match.rt_home != null && match.rt_away != null) {
    return { home: Math.min(home, Number(match.rt_home)), away: Math.min(away, Number(match.rt_away)) };
  }
  return { home: Math.max(0, home - ((extraGoals && extraGoals.home) || 0)), away: Math.max(0, away - ((extraGoals && extraGoals.away) || 0)) };
}
async function loadExtraTimeGoals(client, match) {
  try {
    const { rows } = await client.query(`SELECT team FROM match_events WHERE match_id = $1 AND type = 'GOAL' AND half = 3`, [match.id]);
    return { home: rows.filter((r) => r.team === match.home_team).length, away: rows.filter((r) => r.team === match.away_team).length };
  } catch { return { home: 0, away: 0 }; } // half column not migrated yet
}

export async function settleMatch(matchId, homeScore, awayScore, { force = false } = {}) {
  const client = await pool.connect();
  try {
    const { rows: matchRows } = await client.query('SELECT * FROM matches_cache WHERE id = $1', [matchId]);
    const match = matchRows[0];
    if (!match) return null;
    if (!force && match.status === 'FINISHED' && match.settled_at) return null; // already settled, don't redo

    // Extra time: settle on the score at the end of regular time (see regularTimeScoreFrom)
    const rt = regularTimeScoreFrom(match, await loadExtraTimeGoals(client, match), homeScore, awayScore);
    homeScore = rt.home;
    awayScore = rt.away;

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
    const goalMinutes = legs.some(legNeedsGoalMinutes) ? await loadGoalMinutes(client, matchId, homeScore, awayScore) : undefined;
    const nextEvents = legs.some(legNeedsNextEvent) ? await loadNextEvents(client, match, homeScore, awayScore) : undefined;
    const goalTimeline = legs.some(legNeedsTimeline) ? await loadGoalTimeline(client, match, homeScore, awayScore) : undefined;

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        affectedBetIds.add(leg.bet_id);
        const outcome = determineLegOutcome(leg, {
          winner, totalGoals, bothScored, homeScore, awayScore, stats, goalOrder, goalMinutes, nextEvents, goalTimeline,
          htStats: htStatsOf(match),
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
    // The half-time corner/card snapshot columns come from a newer migration: if they are not
    // there (yet), settle without them instead of letting this whole sweep fail on every run.
    const legsSql = (extra) => `SELECT bs.*, m.result_home, m.result_away, m.ht_home, m.ht_away${extra}
         FROM bet_selections bs
         JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING'
          AND m.status = 'FINISHED'
          AND m.result_home IS NOT NULL AND m.result_away IS NOT NULL`;
    let legs;
    try {
      ({ rows: legs } = await client.query(legsSql(',\n              m.ht_corners_home, m.ht_corners_away, m.ht_cards_home, m.ht_cards_away, m.ht_red_home, m.ht_red_away')));
    } catch (err) {
      console.error('[settle] sweep query with half-time stats failed, retrying without them:', err.message);
      ({ rows: legs } = await client.query(legsSql('')));
    }
    // Tickets whose legs already decide them but whose own status is still PENDING:
    // every leg decided, OR at least one leg LOST (an accumulator is lost the moment
    // one leg loses, whatever its other legs are doing). Without the LOST case a
    // ticket whose recompute was missed once stayed open for good.
    const undecided = (await findDecidedPendingTickets(client)).map((id) => ({ id }));

    const affectedBetIds = new Set(undecided.map((r) => r.id));
    let settledLegs = 0;
    const statsByMatch = new Map();
    const firstByMatch = new Map();
    const minutesByMatch = new Map();
    const nextByMatch = new Map();
    const timelineByMatch = new Map();
    for (const leg of legs) {
      if (legNeedsTimeline(leg) && !timelineByMatch.has(leg.match_id)) {
        const { rows: mr } = await client.query('SELECT id, home_team, away_team FROM matches_cache WHERE id = $1', [leg.match_id]);
        timelineByMatch.set(leg.match_id, mr[0] ? await loadGoalTimeline(client, mr[0], Number(leg.result_home), Number(leg.result_away)) : undefined);
      }
      if (legNeedsNextEvent(leg) && !nextByMatch.has(leg.match_id)) {
        const { rows: mr } = await client.query('SELECT id, home_team, away_team FROM matches_cache WHERE id = $1', [leg.match_id]);
        nextByMatch.set(leg.match_id, mr[0] ? await loadNextEvents(client, mr[0], Number(leg.result_home), Number(leg.result_away)) : undefined);
      }
      if (legNeedsFirstScorer(leg) && !firstByMatch.has(leg.match_id)) {
        const { rows: mr } = await client.query('SELECT id, home_team, away_team FROM matches_cache WHERE id = $1', [leg.match_id]);
        firstByMatch.set(leg.match_id, mr[0] ? await loadGoalOrder(client, mr[0], Number(leg.result_home), Number(leg.result_away)) : undefined);
      }
      if (legNeedsStats(leg) && !statsByMatch.has(leg.match_id)) statsByMatch.set(leg.match_id, await loadMatchStats(client, leg.match_id));
      if (legNeedsGoalMinutes(leg) && !minutesByMatch.has(leg.match_id)) {
        minutesByMatch.set(leg.match_id, await loadGoalMinutes(client, leg.match_id, Number(leg.result_home), Number(leg.result_away)));
      }
    }

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        const home = Number(leg.result_home);
        const away = Number(leg.result_away);
        const outcome = determineLegOutcome(leg, {
          stats: statsByMatch.get(leg.match_id),
          htStats: htStatsOf(leg),
          goalOrder: firstByMatch.get(leg.match_id),
          goalMinutes: minutesByMatch.get(leg.match_id),
          nextEvents: nextByMatch.get(leg.match_id),
          goalTimeline: timelineByMatch.get(leg.match_id),
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

// SETTLE_SCORE_WITHOUT_CLOCK_AFTER_MIN (default 0 = off): a match whose provider score is stored but whose
// clock never was (the feed gave a result and no minute) is NOT settled by default, because such a score
// could be a default 0-0 of a game that never went live, and its tickets end as 24h refunds. Set this to
// e.g. 130 to trust a stored score once that many minutes have passed since kickoff (long after any
// football match, extra time included). Use /api/admin/settle-diagnose to see whether this is your case.
const scoreWithoutClockAfterMs = () => Math.max(0, Number(process.env.SETTLE_SCORE_WITHOUT_CLOCK_AFTER_MIN || 0)) * 60000;

export function canSettleFromLiveScore(row, now = Date.now()) {
  if (!row) return false;
  const hasScore = row.live_home_score != null && row.live_away_score != null
    && Number.isInteger(Number(row.live_home_score)) && Number.isInteger(Number(row.live_away_score));
  const hasClock = row.live_minute != null && String(row.live_minute).trim() !== '';
  if (!hasScore) return false;
  if (!hasClock) {
    const trustAfter = scoreWithoutClockAfterMs();
    const kickoffAt = Date.parse(row.start_time);
    return trustAfter > 0 && Number.isFinite(kickoffAt) && now - kickoffAt >= trustAfter;
  }
  const minute = minuteOf(row.live_minute);
  if (minute != null && minute >= SETTLE_MIN_CLOCK_MINUTE) return true;
  const kickoff = Date.parse(row.start_time);
  return Number.isFinite(kickoff) && now - kickoff >= SETTLE_MIN_ELAPSED_MS;
}

// Human-readable reason a finished/ending match is NOT settled from its live score yet, derived from
// the same facts canSettleFromLiveScore uses (kept next to it so they cannot drift apart). Used by
// the admin diagnostic and by the logs, so "why is this ticket still open?" has a direct answer.
export function explainSettleBlock(row, now = Date.now()) {
  if (!row) return 'match not found';
  if (row.settled_at) return 'already settled';
  const hasScore = row.live_home_score != null && row.live_away_score != null
    && Number.isInteger(Number(row.live_home_score)) && Number.isInteger(Number(row.live_away_score));
  const hasClock = row.live_minute != null && String(row.live_minute).trim() !== '';
  if (!hasScore) return 'no score was ever stored for this match (the feed gave none), so there is no result to settle from';
  if (canSettleFromLiveScore(row, now)) return 'ready: the stored result (' + row.live_home_score + '-' + row.live_away_score + ') is reliable, the next sweep settles it';
  if (!hasClock) return 'a score is stored (' + row.live_home_score + '-' + row.live_away_score + ') but no match clock was ever stored, so the result is not trusted (it could be a default 0-0): settle it by hand, set SETTLE_SCORE_WITHOUT_CLOCK_AFTER_MIN (e.g. 130) to trust such scores, or wait for the 24h refund';
  const kickoff = Date.parse(row.start_time);
  const since = Number.isFinite(kickoff) ? Math.round((now - kickoff) / 60000) + ' min since kickoff' : 'kickoff unknown';
  return 'the match is not over by our rules yet: clock ' + row.live_minute + " (needs >= " + SETTLE_MIN_CLOCK_MINUTE + "') and " + since + ' (needs >= ' + Math.round(SETTLE_MIN_ELAPSED_MS / 60000) + ')';
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
const UNSETTLED_VOID_AFTER_MS = Math.max(0, Number(process.env.UNSETTLED_BET_VOID_AFTER_HOURS ?? 4)) * 3600 * 1000;

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
