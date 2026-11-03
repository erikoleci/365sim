import pool from './db.js';
import { sameFixture } from './fixtureDedupe.js';
import { minuteOf, splitPeriod, marketPeriod, PERIOD_BASE_ALIASES, EXTRA_TIME_STATUSES } from './marketPeriods.js';
import { extraMarketOutcome } from './extraMarkets.js';
import { asianHandicapOutcome, asianTotalOutcome } from './asianLines.js';
import { ticketOutcome } from './ticketOutcome.js';
import {
  goalCountOption, TOTAL_GOALS_PREFIXES, H2H_NAMES, BTTS_NAMES, DOUBLE_CHANCE_NAMES, CORRECT_SCORE_NAMES, HANDICAP_NAMES, parseOverUnder,
  STATS_UNDECIDABLE, EVENT_ORDER_RE, FIRST_TEAM_TO_SCORE_NAMES, LAST_TEAM_TO_SCORE_NAMES, FIRST_GOAL_NAMES, LAST_GOAL_NAMES, BOTH_HALVES_NAMES, GOAL_ORDER_NAMES, FIRST_GOAL_H1_NAMES, nthGoalSpec,
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

// Official rule 7: "Halftime/Fulltime" = the half-time RESULT + the FINAL result of the match ("1/2": home lead at the break, away win at the end).
// This is a different market from "Pushim/Fund" (45/90) below, which is played by halves.
const CLASSIC_HTFT_NAMES = new Set(['ht/ft', 'ht ft', 'ht / ft', 'halftime/fulltime', 'halftime / fulltime', 'halftime fulltime', 'half time/full time', 'half time / full time']);
const HTFT_NAMES = new Set(['pjesa pare / pjesa dyte', 'pjesa pare/pjesa dyte', 'pjesa e pare / pjesa e dyte', 'pjesa e pare/pjesa e dyte', '45/90', '45 / 90', '45/90 min', '45/90 minuta', 'pushim/fund', 'pushimi/fundi', 'pushim / fund', 'pushim fund', 'pjesa e pare/finale', 'pjesa e pare/fund',
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
    for (const sep of [/\s*\/\s*/, /\s*_\s*/, /\s+/]) { // last: "X1 3+" (parts separated by a space)
      const parts = selection.split(sep);
      if (parts.length === marketParts.length) { selectionParts = parts; break; }
    }
  }
  // A half-time/full-time part written with a slash itself ("1/2") inside a slash-separated option
  // ("1/2/3+" for "45/90 & Numri i Golave"): put its two halves back together.
  if (marketParts.length >= 2 && selectionParts.length !== marketParts.length) {
    const slashed = selection.split(/\s*\/\s*/);
    const i = marketParts.findIndex((m) => HTFT_NAMES.has(norm(m)) || CLASSIC_HTFT_NAMES.has(norm(m)));
    if (i >= 0 && slashed.length === marketParts.length + 1) {
      selectionParts = [...slashed.slice(0, i), slashed[i] + '/' + slashed[i + 1], ...slashed.slice(i + 2)];
    }
  }
  if (marketParts.length < 2 || marketParts.length > 3 || marketParts.length !== selectionParts.length) return null;
  // "1st half - double chance & both teams to score": the half named at the start covers EVERY part of the combo
  // (otherwise the second part would be settled on the full match, which is a different bet).
  const lead = String(marketParts[0]).match(/^\s*((?:1st|2nd) half\s*-\s*)/i);
  if (lead) {
    const periodWord = /(1st|2nd) half|pjes|half|\bht\b/i;
    for (let i = 1; i < marketParts.length; i++) if (!periodWord.test(marketParts[i])) marketParts[i] = lead[1] + marketParts[i].trim();
  }
  return marketParts.map((m, i) => ({
    ...leg,
    market_id: '',
    market_name: m.trim(),
    selection_id: selectionParts[i].trim(),
    selection_name: selectionParts[i].trim(),
  }));
}

// "Shtëpiaku" / "Udhëtuesi" are how the feed names the home / away side in team-total markets.
const HOME_SIDE_WORDS = ['shtepiaku', 'vendasi', 'shtepise', 'pritesi', 'pritesit', 'home', 'host'];
const AWAY_SIDE_WORDS = ['udhetuesi', 'udhetuesit', 'mysafiri', 'mysafir', 'vizitori', 'vizitor', 'away', 'guest'];
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
const legNeedsFirstScorer = (leg) => Boolean(nthGoalSpec(norm(leg.market_name))) || GOAL_ORDER_NAMES.has(norm(leg.market_name)) || FIRST_GOAL_H1_NAMES.has(norm(leg.market_name)) || EVENT_ORDER_RE.test(norm(leg.market_name)) || isCornerRace(leg.market_name)
  || (splitCombo(leg) || []).some((p) => GOAL_ORDER_NAMES.has(norm(p.market_name)));

// Final corner / card counters of a match, or undefined if there are none (or the
// lookup fails -- the leg then simply stays PENDING).
// Corner / card totals rebuilt from the match events list ("Ngjarjet"): every corner / card event carries the
// running total of its side in `detail`, so the highest value per type and side is the total at that moment.
// `half` (1 = first half) gives the half-time totals. undefined when the match has no events at all (nothing to rebuild from).
async function loadEventCounters(client, matchId) {
  let rows;
  try {
    ({ rows } = await client.query(
      `SELECT type, team, half, MAX(NULLIF(regexp_replace(detail, '[^0-9]', '', 'g'), '')::int) AS total, COUNT(*)::int AS n
         FROM match_events WHERE match_id = $1 AND type IN ('CORNER','YELLOW_CARD','RED_CARD') GROUP BY type, team, half`, [matchId]));
  } catch {
    try { // half column not migrated: the final totals still work
      ({ rows } = await client.query(
        `SELECT type, team, NULL::int AS half, MAX(NULLIF(regexp_replace(detail, '[^0-9]', '', 'g'), '')::int) AS total, COUNT(*)::int AS n
           FROM match_events WHERE match_id = $1 AND type IN ('CORNER','YELLOW_CARD','RED_CARD') GROUP BY type, team`, [matchId]));
    } catch { return undefined; }
  }
  const { rows: any } = await client.query('SELECT 1 FROM match_events WHERE match_id = $1 LIMIT 1', [matchId]).catch(() => ({ rows: [] }));
  if (!any.length) return undefined;
  const pick = (type, team, onlyHalf1) => {
    const mine = rows.filter((r) => r.type === type && r.team === team && (!onlyHalf1 || Number(r.half) === 1));
    if (!mine.length) return 0;
    return Math.max(...mine.map((r) => Math.max(Number(r.total) || 0, Number(r.n) || 0)));
  };
  const pack = (h1) => {
    const yh = pick('YELLOW_CARD', 'home', h1); const ya = pick('YELLOW_CARD', 'away', h1);
    const rh = pick('RED_CARD', 'home', h1); const ra = pick('RED_CARD', 'away', h1);
    return { cornersHome: pick('CORNER', 'home', h1), cornersAway: pick('CORNER', 'away', h1), yellowHome: yh, yellowAway: ya, redHome: rh, redAway: ra, cardsHome: yh + rh, cardsAway: ya + ra };
  };
  const hasHalf = rows.some((r) => r.half != null);
  return { final: pack(false), ht: hasHalf ? pack(true) : undefined };
}

// Stored counters win; a counter the stats row does not have (or a match without any stats row) is filled from the events.
export async function loadMatchStats(client, matchId) {
  const stored = await loadStoredMatchStats(client, matchId);
  const need = ['cornersHome', 'cornersAway', 'cardsHome', 'cardsAway'];
  if (stored && need.every((k) => stored[k] != null)) return stored;
  const ev = await loadEventCounters(client, matchId).catch(() => undefined);
  if (!ev) return stored;
  const out = { ...ev.final };
  if (stored) for (const [k, v] of Object.entries(stored)) if (v != null) out[k] = v;
  return out;
}

// Half-time counters: the snapshot taken at the break when there is one, otherwise the first-half events.
export async function loadHtStats(client, matchId, row) {
  const snap = htStatsOf(row);
  if (snap) return snap;
  const ev = await loadEventCounters(client, matchId).catch(() => undefined);
  return ev ? ev.ht : undefined;
}

async function loadStoredMatchStats(client, matchId) {
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
// The half-time score rebuilt from the goal events, for a match whose break was never captured (the server was down or
// restarted during it). It is used ONLY when it is certain: every goal of the final score is in the log, each is filed
// under a half (1 / 2) that its minute agrees with, and no second-half goal was logged before a first-half one. Anything
// doubtful gives undefined and the ticket then waits for a person (never a guess about money).
export function halfTimeFromGoalEvents(events, homeTeam, awayTeam, homeScore, awayScore) {
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return undefined;
  if (homeScore + awayScore === 0) return { htHome: 0, htAway: 0 };
  const side = (e) => (e.team === homeTeam || e.team === 'home' ? 'home' : e.team === awayTeam || e.team === 'away' ? 'away' : null);
  const goals = events.filter((e) => side(e));
  if (goals.filter((e) => side(e) === 'home').length !== homeScore || goals.filter((e) => side(e) === 'away').length !== awayScore) return undefined;
  const ordered = [...goals].sort((a, b) => Number(a.created_at) - Number(b.created_at) || Number(a.id) - Number(b.id));
  let htHome = 0; let htAway = 0; let secondSeen = false;
  for (const e of ordered) {
    const half = Number(e.half); const minute = Number(e.minute);
    if ((half !== 1 && half !== 2) || !Number.isFinite(minute)) return undefined;
    if (half === 1) {
      if (secondSeen || minute > 50) return undefined; // first-half stoppage time does not reach past ~50'
      if (side(e) === 'home') htHome++; else htAway++;
    } else {
      if (minute < 46) return undefined;
      secondSeen = true;
    }
  }
  return { htHome, htAway };
}
async function loadHalfTimeScore(client, match, homeScore, awayScore) {
  try {
    const { rows } = await client.query(`SELECT id, team, minute, half, created_at FROM match_events WHERE match_id = $1 AND type = 'GOAL' ORDER BY created_at, id`, [match.id]);
    return halfTimeFromGoalEvents(rows, match.home_team, match.away_team, homeScore, awayScore);
  } catch { return undefined; }
}

async function loadGoalOrder(client, match, homeScore, awayScore) {
  try {
    const { rows } = await client.query(
      `SELECT team, created_at FROM match_events WHERE match_id = $1 AND type = 'GOAL' ORDER BY created_at, id`, [match.id]);
    const order = homeScore + awayScore === 0
      ? { first: 'NONE', second: 'NONE', last: 'NONE', sides: [] }
      : goalOrderFromEvents(rows, match.home_team, match.away_team, homeScore, awayScore);
    // corner / card order: only when the logged events add up to the final counters of each side
    const st = await loadMatchStats(client, match.id);
    // `totals` (type|side -> final counter) lets the running count every event carries answer the question even when
    // some events were never logged (see detailOrderFromEvents).
    const sideOrder = async (types, nHome, nAway, totals) => {
      const { rows: ev } = await client.query(
        `SELECT type, team, detail, created_at FROM match_events WHERE match_id = $1 AND type = ANY($2) ORDER BY created_at, id`, [match.id, types]);
      return mergeSideOrder(sideOrderFromEvents(ev, nHome, nAway), detailOrderFromEvents(ev, totals));
    };
    const { rows: cornerLog } = await client.query(
      `SELECT team, detail, created_at FROM match_events WHERE match_id = $1 AND type = 'CORNER' ORDER BY created_at, id`, [match.id]);
    return {
      ...(order || {}),
      cornerLog, // every corner event in order: "Gara e Korneve" and "Godet kornen e N-te"
      corner: st ? await sideOrder(['CORNER'], numOrNaN(st.cornersHome), numOrNaN(st.cornersAway),
        { 'CORNER|home': numOrNaN(st.cornersHome), 'CORNER|away': numOrNaN(st.cornersAway) }) : undefined,
      card: st ? await sideOrder(['YELLOW_CARD', 'RED_CARD'], numOrNaN(st.cardsHome), numOrNaN(st.cardsAway), {
        'YELLOW_CARD|home': numOrNaN(st.yellowHome), 'YELLOW_CARD|away': numOrNaN(st.yellowAway),
        'RED_CARD|home': numOrNaN(st.redHome), 'RED_CARD|away': numOrNaN(st.redAway),
      }) : undefined,
    };
  } catch { return undefined; }
}

// { first, last } sides ('HOME' | 'AWAY') of corner / card events logged as 'home' / 'away', or undefined
// when the log does not add up to the final counters (events missed while the server was down) or the
// first / last event is tied in time with one of the other side. No events at all -> 'NONE'.
export function sideOrderFromEvents(events, nHome, nAway) {
  if (!Array.isArray(events) || !Number.isFinite(nHome) || !Number.isFinite(nAway)) return undefined;
  if (nHome + nAway === 0) return { first: 'NONE', last: 'NONE' };
  const logHome = events.filter((e) => e.team === 'home').length;
  const logAway = events.filter((e) => e.team === 'away').length;
  const missHome = nHome - logHome;
  const missAway = nAway - logAway;
  if (missHome < 0 || missAway < 0) return undefined; // more events than the counters say: the log cannot be trusted
  const side = (e) => (e && e.team === 'home' ? 'HOME' : e && e.team === 'away' ? 'AWAY' : undefined);
  const pick = (e) => (e && events.some((o) => o.team !== e.team && Number(o.created_at) === Number(e.created_at)) ? undefined : side(e));
  if (missHome === 0 && missAway === 0) return { first: pick(events[0]), last: pick(events[events.length - 1]) };
  // Some events were never logged (feed gap, server restart). If the missing ones all belong to ONE side S they
  // cannot change who was first or last when that event is S anyway, so it is still certain when the first / last
  // LOGGED event is S, or when the other side had no event at all. Anything else stays undecided.
  if (missHome > 0 && missAway > 0) return undefined;
  const S = missHome > 0 ? 'HOME' : 'AWAY';
  if ((S === 'HOME' ? nAway : nHome) === 0) return { first: S, last: S };
  const certain = (e) => (side(e) === S ? pick(e) : undefined);
  return { first: certain(events[0]), last: certain(events[events.length - 1]) };
}

// The same first / last question answered from the running count each event carries in `detail` ("the 5th home
// corner" is logged with detail 5). A gap in the log (an event missed while the server was down or the feed
// dropped) does not matter any more: the FIRST event of a kind is the earliest of the events numbered 1, the LAST
// is the latest of the events numbered like the final counter of their side -- as long as those events are logged.
//   totals: { 'CORNER|home': 5, 'CORNER|away': 3 }  (every 'type|team' the question covers, final counters)
// undefined for a field when a needed event is not in the log, a total is unknown, or the deciding events are tied.
export function detailOrderFromEvents(events, totals) {
  if (!Array.isArray(events) || !totals) return undefined;
  const entries = Object.entries(totals);
  if (!entries.length || entries.some(([, n]) => !Number.isFinite(n) || n < 0)) return undefined;
  const active = entries.filter(([, n]) => n > 0);
  if (!active.length) return { first: 'NONE', last: 'NONE' };
  const countOf = (e) => Number(String(e.detail ?? '').replace(/\D/g, ''));
  const find = (key, n) => events.find((e) => `${e.type || 'CORNER'}|${e.team}` === key && countOf(e) === n);
  const sideOf = (e) => (e.team === 'home' ? 'HOME' : e.team === 'away' ? 'AWAY' : undefined);
  const decide = (picks, latest) => {
    if (picks.some((p) => !p)) return undefined;
    const times = picks.map((p) => Number(p.created_at));
    if (times.some((x) => !Number.isFinite(x))) return undefined;
    const best = latest ? Math.max(...times) : Math.min(...times);
    const sides = new Set(picks.filter((p, i) => times[i] === best).map(sideOf));
    return sides.size === 1 ? [...sides][0] : undefined; // a tie between the two sides cannot be told apart
  };
  return { first: decide(active.map(([k]) => find(k, 1)), false), last: decide(active.map(([k, n]) => find(k, n)), true) };
}
// Two answers to the same question: the one that is certain wins; two certain answers that disagree cancel out.
export function mergeSideOrder(a, b) {
  if (!a && !b) return undefined;
  const pick = (x, y) => (x && y && x !== y ? undefined : (x || y));
  return { first: pick(a && a.first, b && b.first), last: pick(a && a.last, b && b.last) };
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
  // Both Nth corners are in the log with their running count: no need for the whole log to be complete.
  const nth = (team) => {
    const e = events.find((x) => x.team === team && x.detail != null && Number(String(x.detail).replace(/\D/g, '')) === n);
    return e ? Number(e.created_at) : NaN;
  };
  const dHome = nth('home'); const dAway = nth('away');
  if (Number.isFinite(dHome) && Number.isFinite(dAway) && dHome !== dAway) return dHome < dAway ? 'HOME' : 'AWAY';
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
  if (homeScore + awayScore === 0) return { first: 'NONE', second: 'NONE', last: 'NONE', sides: [] };
  const nHome = events.filter((e) => e.team === homeTeam).length;
  const nAway = events.filter((e) => e.team === awayTeam).length;
  if (nHome !== homeScore || nAway !== awayScore || !events.length) return undefined;
  const side = (e) => (e.team === homeTeam ? 'HOME' : e.team === awayTeam ? 'AWAY' : undefined);
  const pick = (e) => (events.some((o) => o.team !== e.team && Number(o.created_at) === Number(e.created_at)) ? undefined : side(e));
  // sides = the scoring side of every goal in order (undefined where two sides scored at the very same instant)
  return { first: pick(events[0]), second: events.length >= 2 ? pick(events[1]) : 'NONE', last: pick(events[events.length - 1]), sides: events.map(pick) };
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
  const t = String(text ?? '').toUpperCase().replace(/[\s/\-_]/g, '')
    .replace('HOMEDRAW', '1X').replace('DRAWAWAY', 'X2').replace('HOMEAWAY', '12'); // feed words: HomeDraw / DrawAway / HomeAway
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
  let m = text.trim().match(/^(.*?)\s*\(\s*([+-]?\d+(?:[.,]\d+)?)\s*\)\s*$/);
  // The provider's "Handikap" options come as "1 -0.25" / "2 -0.5" (the line inside the text, and the board
  // appends "(undefined)" because the option has no separate point): read the line from the text itself.
  if (!m) m = text.trim().match(/^([12])\s+([+-]?\d+(?:[.,]\d+)?)(?:\s*\(\s*undefined\s*\))?$/i);
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

const isKnownWinner = (w) => w === 'HOME' || w === 'AWAY' || w === 'DRAW';

export function determineLegOutcome(leg, { winner, totalGoals, bothScored, homeScore, awayScore, htHome, htAway, stats, htStats, goalOrder, goalMinutes, nextEvents, goalTimeline, aggregate }) {
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
  const extra = extraMarketOutcome(leg, marketName, { homeScore, awayScore, htHome, htAway, stats, htStats, aggregate });
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

  // ---- "Halftime/Fulltime" (HT/FT) -> "1/2": half-time result + FINAL result ----
  if (CLASSIC_HTFT_NAMES.has(marketName)) {
    const m = String(leg.selection_name || leg.selection_id).trim().toLowerCase().match(/^([12x])\s*[\/-]\s*([12x])$/);
    if (!m || !hasScore) return null;
    const sign = (h, a) => (h > a ? '1' : a > h ? '2' : 'x');
    if (sign(homeScore, awayScore) !== m[2]) return 'LOST'; // the final result alone already decides a loss
    if (!Number.isFinite(htHome) || !Number.isFinite(htAway)) return null; // half-time score missing: a win cannot be proven
    return sign(htHome, htAway) === m[1] ? 'WON' : 'LOST';
  }

  // ---- "45/90" ("Pushim/Fund") -> "1/2": played BY HALVES ----
  // The first sign is who WINS THE FIRST HALF (goals of the first 45'), the second sign who WINS THE SECOND
  // HALF on its own (goals of the second half = final minus half-time) -- not the final result. Real - Barcelona
  // "1/2" = Real win the first half, Barcelona win the second half. Combos ("2/1 & 3+") add the usual
  // whole-match condition (goals of the whole game) on top.
  if (HTFT_NAMES.has(marketName)) {
    const m = String(leg.selection_name || leg.selection_id).trim().toLowerCase().match(/^([12x])\s*[\/-]\s*([12x])$/);
    if (!m || !hasScore) return null;
    const sign = (h, a) => (h > a ? '1' : a > h ? '2' : 'x');
    if (!Number.isFinite(htHome) || !Number.isFinite(htAway)) {
      // The half-time score was never stored (e.g. the server restarted during the match), so the halves cannot be
      // told apart. A LOSS can still be proven from the final score alone: every half won by a side needs at
      // least one goal of that side ("1/1" needs two home goals, "1/2" one home and one away goal ...).
      // A win cannot be proven, so that case stays open for the admin.
      const needHome = (m[1] === '1' ? 1 : 0) + (m[2] === '1' ? 1 : 0);
      const needAway = (m[1] === '2' ? 1 : 0) + (m[2] === '2' ? 1 : 0);
      if (homeScore < needHome || awayScore < needAway) return 'LOST';
      return null;
    }
    const secondHome = homeScore - htHome;
    const secondAway = awayScore - htAway;
    if (secondHome < 0 || secondAway < 0) return null;
    return sign(htHome, htAway) === m[1] && sign(secondHome, secondAway) === m[2] ? 'WON' : 'LOST';
  }

  // "Shenon golin e trete|peste (skuadra)" / "Shenon Golin e 1|2 Pjesa1": the team that scores the Nth goal (of the match /
  // of the first half); X = there is no such goal. Needs the goal order to add up to the final score, else it stays PENDING.
  const nthGoal = nthGoalSpec(marketName);
  if (nthGoal) {
    const sel = norm(leg.selection_name || leg.selection_id);
    const picked = sel === '1' ? 'HOME' : sel === '2' ? 'AWAY' : sel === 'x' ? 'NONE' : null;
    if (!picked || !hasScore) return null;
    let exists;
    if (nthGoal.half1) {
      if (!Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
      exists = htHome + htAway >= nthGoal.n;
    } else exists = homeScore + awayScore >= nthGoal.n;
    const actual = exists ? (goalOrder && goalOrder.sides && goalOrder.sides[nthGoal.n - 1]) : 'NONE';
    if (actual !== 'HOME' && actual !== 'AWAY' && actual !== 'NONE') return null; // order not reliable: stays PENDING
    return picked === actual ? 'WON' : 'LOST';
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
    if (!isKnownWinner(winner)) return null; // no usable result: PENDING, never a guessed LOST
    return side ? (side === winner ? 'WON' : 'LOST') : null;
  }

  if (BTTS_NAMES.has(marketName) || marketId.endsWith('-btts')) {
    const sel = norm(leg.selection_name || leg.selection_id);
    // the provider's "Gol Jo Gol Live" / "Gol / Jo Gol Ne P2" label the options 1 = Gol, 2 = Jo Gol
    const numeric = marketName === 'gol jo gol live';
    const tight = sel.replace(/[\s_-]/g, ''); // "Jo Gol", "J_Gol", "JGol" ...
    // GG = both score; JG / NG = not both (the short labels used on the slip). Before they were left undecided (null).
    if (sel === 'po' || sel === 'yes' || sel === 'gol' || tight === 'gg' || (numeric && sel === '1')) return bothScored ? 'WON' : 'LOST';
    if (sel === 'jo' || sel === 'no' || tight === 'jogol' || tight === 'jgol' || tight === 'nogoal' || tight === 'jg' || tight === 'ng' || (numeric && sel === '2')) return !bothScored ? 'WON' : 'LOST';
    return null;
  }

  if (DOUBLE_CHANCE_NAMES.has(marketName) || marketId.endsWith('-double_chance')) {
    const dc = normDoubleChance(leg.selection_id) || normDoubleChance(leg.selection_name);
    if (!dc || !isKnownWinner(winner)) return null;
    const ok = dc === '1X' ? winner !== 'AWAY' : dc === 'X2' ? winner !== 'HOME' : winner !== 'DRAW';
    return ok ? 'WON' : 'LOST';
  }

  if (marketId.endsWith('-draw_no_bet') || /\b(no bet|draw no bet)\b|barazimi = rimbursim/.test(marketName)) {
    const side = sideOfSelection(leg);
    if (side !== 'HOME' && side !== 'AWAY') return null;
    if (!isKnownWinner(winner)) return null;
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
export async function creditWithLedger(client, userId, amount, type, betId, currency = 'ALL') {
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

// ---- "To qualify": the sum of the two legs of a tie -----------------------------------------
// The other leg is the same competition, the same two teams with the roles swapped, already finished.
// Finished matches leave matches_cache after about a week, so the result of every settled match is also
// kept in match_results (migration 0019) for TIE_WINDOW_DAYS.
export const TIE_WINDOW_DAYS = 75;
const legNeedsAggregate = (leg) => /^(to qualify|skuadra qe kualifikohet)$/.test(norm(leg.market_name));

// The candidate (rows of { start_time, result_home, result_away }) whose kick-off is nearest to this match's, within the window.
export function pickOtherLeg(startTime, candidates, windowDays = TIE_WINDOW_DAYS) {
  const t0 = Date.parse(startTime);
  let best = null; let bestGap = Infinity;
  for (const c of candidates || []) {
    if (c.result_home == null || c.result_away == null) continue;
    const gap = Math.abs(Date.parse(c.start_time) - t0);
    if (!Number.isFinite(gap) || gap > windowDays * 86400000 || gap >= bestGap) continue;
    best = c; bestGap = gap;
  }
  return best;
}
// Goals of both legs from the sides of this match: its own score + what the same side scored in the other leg.
export function aggregateFrom(homeScore, awayScore, other) {
  if (!other || ![homeScore, awayScore, Number(other.result_home), Number(other.result_away)].every(Number.isFinite)) return undefined;
  return { home: homeScore + Number(other.result_away), away: awayScore + Number(other.result_home) };
}
async function loadAggregate(client, matchId, homeScore, awayScore) {
  try {
    const { rows: [m] } = await client.query('SELECT id, league, home_team, away_team, start_time FROM matches_cache WHERE id = $1', [matchId]);
    if (!m) return undefined;
    // The other leg has the sides swapped. Same league, finished, a stored score; the club names are compared
    // loosely because the feed spells one club several ways ("Stade Brest 29" / "Brest"), and an exact match
    // would silently lose the first leg's goals.
    const params = [m.league, m.id];
    let { rows: cands } = await client.query(
      `SELECT id, home_team, away_team, start_time, result_home, result_away FROM matches_cache
        WHERE league = $1 AND id <> $2 AND status = 'FINISHED' AND result_home IS NOT NULL AND result_away IS NOT NULL`, params);
    try {
      const { rows: archived } = await client.query(
        `SELECT match_id AS id, home_team, away_team, start_time, result_home, result_away FROM match_results
          WHERE league = $1 AND match_id <> $2`, params);
      cands = cands.concat(archived);
    } catch { /* archive not migrated yet: the cache alone */ }
    const swapped = { homeTeam: m.away_team, awayTeam: m.home_team };
    cands = cands.filter((c) => (looseSameClub(swapped.homeTeam, c.home_team) && looseSameClub(swapped.awayTeam, c.away_team)));
    return aggregateFrom(homeScore, awayScore, pickOtherLeg(m.start_time, cands));
  } catch { return undefined; }
}
// Keeps the regular-time result of a settled match for the other leg of its tie.
async function archiveResult(client, matchId, homeScore, awayScore) {
  try {
    await client.query(
      `INSERT INTO match_results (match_id, league, home_team, away_team, start_time, result_home, result_away, saved_at)
       SELECT id, league, home_team, away_team, start_time, $2, $3, $4 FROM matches_cache WHERE id = $1
       ON CONFLICT (match_id) DO UPDATE SET result_home = EXCLUDED.result_home, result_away = EXCLUDED.result_away, saved_at = EXCLUDED.saved_at`,
      [matchId, homeScore, awayScore, Date.now()]);
  } catch { /* table not migrated yet: nothing to keep it in */ }
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
    const htStats = legs.some(legNeedsStats) ? await loadHtStats(client, matchId, match) : undefined;
    // The stored half-time score; when the break was never captured, the one the goal events prove (see halfTimeFromGoalEvents).
    const htScore = match.ht_home != null && match.ht_away != null
      ? { htHome: Number(match.ht_home), htAway: Number(match.ht_away) }
      : await loadHalfTimeScore(client, match, homeScore, awayScore);
    const goalOrder = legs.some(legNeedsFirstScorer) ? await loadGoalOrder(client, match, homeScore, awayScore) : undefined;
    const goalMinutes = legs.some(legNeedsGoalMinutes) ? await loadGoalMinutes(client, matchId, homeScore, awayScore) : undefined;
    const nextEvents = legs.some(legNeedsNextEvent) ? await loadNextEvents(client, match, homeScore, awayScore) : undefined;
    const goalTimeline = legs.some(legNeedsTimeline) ? await loadGoalTimeline(client, match, homeScore, awayScore) : undefined;
    const aggregate = legs.some(legNeedsAggregate) ? await loadAggregate(client, matchId, homeScore, awayScore) : undefined;

    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        affectedBetIds.add(leg.bet_id);
        const outcome = determineLegOutcome(leg, {
          winner, totalGoals, bothScored, homeScore, awayScore, stats, goalOrder, goalMinutes, nextEvents, goalTimeline,
          htStats, aggregate,
          htHome: htScore ? htScore.htHome : undefined,
          htAway: htScore ? htScore.htAway : undefined,
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
    await archiveResult(client, matchId, homeScore, awayScore); // after the commit: a missing table must never break a settlement

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
    const htStatsByMatch = new Map();
    const htScoreByMatch = new Map();
    const firstByMatch = new Map();
    const minutesByMatch = new Map();
    const nextByMatch = new Map();
    const timelineByMatch = new Map();
    const aggregateByMatch = new Map();
    for (const leg of legs) {
      if (legNeedsAggregate(leg) && !aggregateByMatch.has(leg.match_id)) {
        aggregateByMatch.set(leg.match_id, await loadAggregate(client, leg.match_id, Number(leg.result_home), Number(leg.result_away)));
      }
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
      if (legNeedsStats(leg) && !htStatsByMatch.has(leg.match_id)) htStatsByMatch.set(leg.match_id, await loadHtStats(client, leg.match_id, leg));
      if (!htScoreByMatch.has(leg.match_id)) {
        if (leg.ht_home != null && leg.ht_away != null) htScoreByMatch.set(leg.match_id, { htHome: Number(leg.ht_home), htAway: Number(leg.ht_away) });
        else {
          const { rows: mr } = await client.query('SELECT id, home_team, away_team FROM matches_cache WHERE id = $1', [leg.match_id]);
          htScoreByMatch.set(leg.match_id, mr[0] ? await loadHalfTimeScore(client, mr[0], Number(leg.result_home), Number(leg.result_away)) : undefined);
        }
      }
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
          htStats: htStatsByMatch.get(leg.match_id),
          goalOrder: firstByMatch.get(leg.match_id),
          goalMinutes: minutesByMatch.get(leg.match_id),
          nextEvents: nextByMatch.get(leg.match_id),
          goalTimeline: timelineByMatch.get(leg.match_id),
          aggregate: aggregateByMatch.get(leg.match_id),
          winner: home > away ? 'HOME' : away > home ? 'AWAY' : 'DRAW',
          totalGoals: home + away,
          bothScored: home > 0 && away > 0,
          homeScore: home,
          awayScore: away,
          htHome: (htScoreByMatch.get(leg.match_id) || {}).htHome,
          htAway: (htScoreByMatch.get(leg.match_id) || {}).htAway,
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

// What the rules would decide for one open leg of a FINISHED match with a stored result, using only what the match row
// holds (final score, stored half-time score). Used by the "Pse është hapur?" explanation: 'WON' | 'LOST' | 'VOID' | ... when the
// sweep can close it on its own, null when the market has no rule or needs data that is not in the row.
export function wouldSettleNow(leg, match) {
  const h = Number(match && match.result_home); const a = Number(match && match.result_away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const hasHt = match.ht_home != null && match.ht_away != null;
  try {
    return determineLegOutcome(leg, {
      winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0, homeScore: h, awayScore: a,
      htHome: hasHt ? Number(match.ht_home) : undefined, htAway: hasHt ? Number(match.ht_away) : undefined,
    }) || null;
  } catch { return null; }
}

// ---- first-half markets close at the half-time whistle ---------------------------------------------------
// A ticket on a first-half market ("Rezultati Pjesa e Parë", "Gola P1", "Gol/Jo Gol P1" ...) is decided the moment
// the first half is over: it must not wait for the end of the match (a match that is later abandoned or
// never finishes would otherwise leave it open). The half-time score is stored by captureHalfTimeScore (halfTime.js).
// Only markets that depend on the first half ALONE are settled here; anything that also needs the final result
// (45/90, "& Totali" combos ...) stays for the normal sweep.
export function isPureFirstHalfMarket(marketName) {
  const n = norm(marketName);
  if (!n || marketPeriod(marketName) !== 'H1') return false;
  if (n.includes('&') || HTFT_NAMES.has(n)) return false;
  return !/\b(final|finale|fund|ft|2h|p2|pjesa e dyte|pjesen e dyte)\b/.test(n);
}

export async function settleFirstHalfLegs() {
  const client = await pool.connect();
  try {
    const legsSql = (extra) => `SELECT bs.*, m.ht_home, m.ht_away${extra}
         FROM bet_selections bs
         JOIN bets b ON b.id = bs.bet_id AND b.status = 'PENDING'
         JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING' AND m.ht_home IS NOT NULL AND m.ht_away IS NOT NULL`;
    let rows;
    try {
      ({ rows } = await client.query(legsSql(', m.ht_corners_home, m.ht_corners_away, m.ht_cards_home, m.ht_cards_away, m.ht_red_home, m.ht_red_away')));
    } catch {
      ({ rows } = await client.query(legsSql('')));
    }
    const legs = rows.filter((l) => isPureFirstHalfMarket(l.market_name));
    if (!legs.length) return { settledLegs: 0, recomputedBets: 0 };

    const htStatsByMatch = new Map();
    for (const leg of legs) {
      if (legNeedsStats(leg) && !htStatsByMatch.has(leg.match_id)) htStatsByMatch.set(leg.match_id, await loadHtStats(client, leg.match_id, leg));
    }
    const affected = new Set();
    let settledLegs = 0;
    await client.query('BEGIN');
    try {
      for (const leg of legs) {
        const h = Number(leg.ht_home); const a = Number(leg.ht_away);
        const htStats = htStatsByMatch.get(leg.match_id);
        const outcome = determineLegOutcome(leg, {
          winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0,
          homeScore: h, awayScore: a, htHome: h, htAway: a, stats: htStats, htStats,
        });
        if (!outcome) continue;
        await client.query(`UPDATE bet_selections SET status = $1 WHERE id = $2 AND status = 'PENDING'`, [outcome, leg.id]);
        affected.add(leg.bet_id);
        settledLegs++;
      }
      for (const betId of affected) await recomputeBetStatus(betId, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return { settledLegs, recomputedBets: affected.size };
  } finally {
    client.release();
  }
}

// ---- legs pinned to the pre-match twin of a fixture ---------------------------
// The provider keeps the SAME real fixture under two ids: the pre-match catalogue record (full markets,
// the one a ticket usually gets pinned to) and the in-play record that actually receives the score,
// the clock and the FINISHED status. The twin a ticket points at can stay UPCOMING for ever, so none of
// the sweeps above ever sees a result for it and the ticket sits open until an admin closes it by hand.
// pickLiveTwin() finds the finished twin; rebindLegsToLiveTwin() re-points the still-PENDING legs at it so
// the normal sweep (with that twin's score and event log) settles them like any other leg.
export const TWIN_KICKOFF_WINDOW_MS = 3 * 3600 * 1000;
const TWIN_WAIT_AFTER_KICKOFF_MS = 130 * 60 * 1000;


// Looser club-name test used ONLY when two records kick off at (almost) the same minute: the feed spells
// one club several ways ("Stade Brest 29" / "Brest", "CA Osasuna" / "Osasuna", "RC Deportivo de A Coruna" /
// "Deportivo La Coruna"). Drops generic words and digits, then one name must contain the other's key words.
const GENERIC_CLUB_WORDS = new Set(['fc', 'cf', 'ca', 'rc', 'sc', 'ac', 'as', 'cd', 'sd', 'ud', 'afc', 'sk', 'fk', 'stade', 'de', 'la', 'le', 'el', 'a', 'da', 'do', 'of', 'club', 'calcio']);
function clubKeyWords(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !GENERIC_CLUB_WORDS.has(t));
}
function looseSameClub(a, b) {
  const ka = clubKeyWords(a), kb = clubKeyWords(b);
  if (!ka.length || !kb.length) return false;
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return s.every((t) => l.some((u) => u === t || (t.length >= 4 && u.length >= 4 && (u.startsWith(t) || t.startsWith(u)))));
}
function looseSameFixture(wanted, c) {
  return (looseSameClub(wanted.homeTeam, c.homeTeam) && looseSameClub(wanted.awayTeam, c.awayTeam))
    || (looseSameClub(wanted.homeTeam, c.awayTeam) && looseSameClub(wanted.awayTeam, c.homeTeam));
}

export function pickLiveTwin(leg, candidates, now = Date.now()) {
  const own = Date.parse(leg.start_time);
  const placed = Number(leg.bet_created_at);
  // Reference time of the fixture: its own kickoff, or (row gone) the moment the ticket was placed.
  const ref = Number.isFinite(own) ? own : placed;
  const window = Number.isFinite(own) ? TWIN_KICKOFF_WINDOW_MS : 36 * 3600 * 1000;
  if (!Number.isFinite(ref) || now - ref < TWIN_WAIT_AFTER_KICKOFF_MS) return null;
  const wanted = { homeTeam: leg.match_home, awayTeam: leg.match_away };
  let best = null;
  for (const c of candidates) {
    if (c.id === leg.match_id) continue;
    const ready = c.status === 'FINISHED' && ((c.result_home != null && c.result_away != null) || canSettleFromLiveScore(c, now));
    if (!ready) continue;
    const start = Date.parse(c.start_time);
    if (!Number.isFinite(start) || Math.abs(start - ref) > window) continue;
    const candTeams = { homeTeam: c.home_team, awayTeam: c.away_team };
    const sameKickoffMinute = Math.abs(start - ref) <= 10 * 60000;
    if (!sameFixture(wanted, candTeams) && !(sameKickoffMinute && looseSameFixture(wanted, candTeams))) continue;
    const gap = Math.abs(start - ref);
    if (!best || gap < best.gap) best = { id: c.id, gap };
  }
  return best ? best.id : null;
}

export async function rebindLegsToLiveTwin({ now = Date.now() } = {}) {
  const { rows: legs } = await pool.query(
    `SELECT bs.id, bs.bet_id, bs.match_id, bs.match_home, bs.match_away, bs.market_name,
            m.start_time, m.status AS match_status, b.created_at AS bet_created_at
       FROM bet_selections bs
       JOIN bets b ON b.id = bs.bet_id AND b.status IN ('PENDING', 'LOST')
       LEFT JOIN matches_cache m ON m.id = bs.match_id
      WHERE bs.status = 'PENDING' AND (m.id IS NULL OR m.status <> 'FINISHED')`
  );
  if (legs.length === 0) return { reboundLegs: 0 };
  const { rows: candidates } = await pool.query(
    `SELECT id, home_team, away_team, start_time, status, result_home, result_away,
            live_home_score, live_away_score, live_minute
       FROM matches_cache WHERE status = 'FINISHED'`
  );
  let reboundLegs = 0;
  const reboundTwins = new Set();
  for (const leg of legs) {
    const twin = pickLiveTwin(leg, candidates, now);
    if (!twin) continue;
    const r = await pool.query(`UPDATE bet_selections SET match_id = $1 WHERE id = $2 AND status = 'PENDING'`, [twin, leg.id]);
    if (r.rowCount) {
      reboundLegs++;
      reboundTwins.add(twin);
      console.log('[settle] leg ' + leg.id + ' (' + leg.match_home + ' v ' + leg.match_away + ', "' + leg.market_name + '") was pinned to a fixture record that never finished: moved ' + leg.match_id + ' -> ' + twin);
    }
  }
  // The finished twin may have been settled already (while no ticket was attached to it), and settleMatch skips a
  // match it already settled. Settle the newly attached legs now, from the twin's stored final score. force only
  // touches legs still PENDING, so nothing already settled is redone.
  for (const twinId of reboundTwins) {
    const c = candidates.find((x) => x.id === twinId);
    const h = c && (c.result_home ?? c.live_home_score);
    const a = c && (c.result_away ?? c.live_away_score);
    if (h == null || a == null) continue;
    try {
      await settleMatch(twinId, Number(h), Number(a), { force: true });
      console.log('[settle] settled legs moved onto ' + twinId + ' with ' + h + '-' + a);
    } catch (err) {
      console.error('[settle] settling moved legs on ' + twinId + ' failed (retried next sweep):', err.message);
    }
  }
  return { reboundLegs };
}

// Catch-all: ANY leg still PENDING whose match is FINISHED with a stored final score gets settled, whatever the
// ticket's status is. A ticket lost on its first leg used to leave its other legs open for ever ("Hapur") because
// the sweeps only looked at open tickets; and a finished match settled earlier is skipped by settleMatch, so legs
// attached to it later were never decided. force only touches legs still PENDING, so nothing settled is redone.
export async function settleOpenLegsOfFinishedMatches() {
  const { rows } = await pool.query(
    `SELECT DISTINCT m.id, m.result_home, m.result_away
       FROM matches_cache m
       JOIN bet_selections bs ON bs.match_id = m.id AND bs.status = 'PENDING'
      WHERE m.status = 'FINISHED' AND m.result_home IS NOT NULL AND m.result_away IS NOT NULL`
  );
  let settledMatches = 0;
  for (const m of rows) {
    try {
      const r = await settleMatch(m.id, Number(m.result_home), Number(m.result_away), { force: true });
      if (r && r.autoSettledLegs) { settledMatches++; console.log('[settle] open legs of ' + m.id + ' settled with ' + m.result_home + '-' + m.result_away); }
    } catch (err) {
      console.error('[settle] open-leg settle of ' + m.id + ' failed (retried next sweep):', err.message);
    }
  }
  return { settledMatches };
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

// SETTLE_SCORE_WITHOUT_CLOCK_AFTER_MIN (default 130; 0 = off): a match whose provider score is stored but whose
// clock never was (the feed gave a result and no minute) is NOT settled by default, because such a score
// could be a default 0-0 of a game that never went live, and its tickets end as 24h refunds. Set this to
// e.g. 130 to trust a stored score once that many minutes have passed since kickoff (long after any
// football match, extra time included). Use /api/admin/settle-diagnose to see whether this is your case.
const scoreWithoutClockAfterMs = () => Math.max(0, Number(process.env.SETTLE_SCORE_WITHOUT_CLOCK_AFTER_MIN ?? 130)) * 60000;

export function canSettleFromLiveScore(row, now = Date.now()) {
  if (!row) return false;
  const hasScore = row.live_home_score != null && row.live_away_score != null
    && Number.isInteger(Number(row.live_home_score)) && Number.isInteger(Number(row.live_away_score));
  const hasClock = row.live_minute != null && String(row.live_minute).trim() !== '';
  if (!hasScore) return false;
  if (!hasClock) {
    const trustAfter = scoreWithoutClockAfterMs();
    const kickoffAt = Date.parse(row.start_time);
    // The provider itself marks the match FINISHED and gave a score: a non-zero score cannot be a default
    // 0-0, so trust it once the match has had time to be played (no clock needed). Fixes tickets that sat
    // open because the feed sent a final score but never a minute.
    if (String(row.status || '').toUpperCase() === 'FINISHED' && Number.isFinite(kickoffAt)
      && Number(row.live_home_score) + Number(row.live_away_score) > 0
      && now - kickoffAt >= 100 * 60000) return true;
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
    `SELECT m.id, m.status, m.start_time, m.live_home_score, m.live_away_score, m.live_minute
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
// UNSETTLED_BET_VOID_AFTER_HOURS past kickoff (OFF by default: a ticket that cannot be decided stays open for the
// admin / super admin to close by hand as won or lost, it is never refunded on its own), such a leg is VOIDed:
// it drops out of the ticket (a single bet is refunded, an accumulator is paid on
// its remaining legs) -- the same treatment a bookmaker gives a postponed match.
// 0 (the default) disables it. Admins settle these by hand (Fituese / Humbëse on the ticket, or the Pezull panel).
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

// ---- in-play loss: close a leg the moment it can no longer win --------------------------------------------
// A leg on a LIVE match is marked LOST (and its ticket with it) as soon as EVERY way the match can still
// continue ends in a loss: "Under 2.5" with 3 goals on the board, "BTTS - No" once both teams have scored,
// "0-1 goals" after the 2nd goal, "Under 9.5 corners" at the 10th corner, "Home win" is NOT closed at 0-1
// (a comeback is still possible). Only LOST is ever decided early, never WON/VOID.
//
// How it is decided: the leg is evaluated by the normal rules (determineLegOutcome) on the current score and
// counters PLUS every plausible future (up to +5 goals per side, +0..+40 corners/cards). It is lost-for-sure
// only when all of those answers are LOST. A market the rules cannot decide from score/counters alone (first
// scorer, minutes, halves, combos ...) answers null somewhere on that grid and is therefore never closed here.
//
// Safety net against a feed glitch (a goal that VAR later cancels, a corner counter that jumps): the same leg
// must come out lost-for-sure on EARLY_LOSS_CONFIRM_MS worth of consecutive sweeps before it is written.
// On by default; set EARLY_LOSS_SETTLE=0 in .env to switch it off.
const EARLY_LOSS_ENABLED = () => process.env.EARLY_LOSS_SETTLE !== '0';
const EARLY_LOSS_CONFIRM_MS = () => Number(process.env.EARLY_LOSS_CONFIRM_MS) || 90 * 1000;
// A certain WIN pays money, so it must stay certain longer (a goal that VAR cancels shows up within minutes).
const EARLY_WIN_CONFIRM_MS = () => Number(process.env.EARLY_WIN_CONFIRM_MS) || 5 * 60 * 1000;
const earlyLossSeen = new Map(); // leg id -> { since, key } (in memory: a restart simply restarts the confirmation)
const GOAL_STEPS = [0, 1, 2, 3, 4, 5];
const COUNT_STEPS = [0, 1, 2, 3, 5, 8, 13, 21, 40];

// 'LOST' / 'WON' when EVERY possible continuation of the match gives that same answer, else null.
export function sureOutcome(leg, score, stats) {
  const { h, a } = score;
  const isStats = STATS_MARKET.test(norm(leg.market_name));
  const futures = [];
  if (isStats) {
    if (!stats) return null;
    for (const dh of COUNT_STEPS) for (const da of COUNT_STEPS) futures.push({ dh: 0, da: 0, sh: dh, sa: da });
  } else {
    for (const dh of GOAL_STEPS) for (const da of GOAL_STEPS) futures.push({ dh, da, sh: 0, sa: 0 });
  }
  let first;
  for (const f of futures) {
    const fh = h + f.dh; const fa = a + f.da;
    let futureStats;
    if (isStats) {
      futureStats = { ...stats };
      for (const [k, add] of [['cornersHome', f.sh], ['cornersAway', f.sa], ['cardsHome', f.sh], ['cardsAway', f.sa], ['yellowHome', f.sh], ['yellowAway', f.sa], ['redHome', f.sh], ['redAway', f.sa]]) {
        if (Number.isFinite(Number(stats[k]))) futureStats[k] = Number(stats[k]) + add;
      }
    }
    let outcome;
    try {
      outcome = determineLegOutcome(leg, {
        winner: fh > fa ? 'HOME' : fa > fh ? 'AWAY' : 'DRAW', totalGoals: fh + fa, bothScored: fh > 0 && fa > 0,
        homeScore: fh, awayScore: fa, stats: futureStats,
      });
    } catch { return null; }
    if (outcome !== 'LOST' && outcome !== 'WON') return null;
    if (first === undefined) first = outcome;
    else if (outcome !== first) return null;
  }
  return first ?? null;
}

export const isLostForSure = (leg, score, stats) => sureOutcome(leg, score, stats) === 'LOST';


export async function settleLostLiveLegs({ now = Date.now() } = {}) {
  if (!EARLY_LOSS_ENABLED()) return { settledLegs: 0, recomputedBets: 0, disabled: true };
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT bs.*, m.live_home_score AS lh, m.live_away_score AS la, m.live_status AS lstatus
         FROM bet_selections bs
         JOIN bets b ON b.id = bs.bet_id AND b.status = 'PENDING'
         JOIN matches_cache m ON m.id = bs.match_id
        WHERE bs.status = 'PENDING' AND m.status = 'LIVE' AND m.live_home_score IS NOT NULL AND m.live_away_score IS NOT NULL`
    );
    const legs = rows.filter((l) => {
      const n = norm(l.market_name);
      if (!n || marketPeriod(l.market_name) !== null) return false; // half markets close at their own whistle
      if (/&| dhe |\+/.test(String(l.market_name))) return false; // combos
      if (EXTRA_TIME_STATUSES.has(String(l.lstatus || '').toUpperCase())) return false;
      return true;
    });
    const statsByMatch = new Map();
    const lostNow = [];
    const stillLost = new Set();
    for (const leg of legs) {
      const score = { h: Number(leg.lh), a: Number(leg.la) };
      if (!Number.isFinite(score.h) || !Number.isFinite(score.a)) continue;
      let stats;
      if (STATS_MARKET.test(norm(leg.market_name))) {
        if (!statsByMatch.has(leg.match_id)) statsByMatch.set(leg.match_id, await loadMatchStats(client, leg.match_id).catch(() => undefined));
        stats = statsByMatch.get(leg.match_id);
      }
      const sure = sureOutcome(leg, score, stats);
      if (!sure) continue;
      stillLost.add(leg.id);
      const key = `${sure}|${score.h}-${score.a}|${stats ? [stats.cornersHome, stats.cornersAway, stats.cardsHome, stats.cardsAway].join(',') : ''}`;
      const seen = earlyLossSeen.get(leg.id);
      // the position must stay the same for the whole confirmation window (a changed score restarts it)
      if (!seen || seen.key !== key) { earlyLossSeen.set(leg.id, { since: now, key }); continue; }
      if (now - seen.since >= (sure === 'LOST' ? EARLY_LOSS_CONFIRM_MS() : EARLY_WIN_CONFIRM_MS())) lostNow.push({ ...leg, sure });
    }
    for (const id of Array.from(earlyLossSeen.keys())) if (!stillLost.has(id)) earlyLossSeen.delete(id);
    if (!lostNow.length) return { settledLegs: 0, recomputedBets: 0 };

    const affected = new Set();
    await client.query('BEGIN');
    try {
      for (const leg of lostNow) {
        const r = await client.query(`UPDATE bet_selections SET status = $1 WHERE id = $2 AND status = 'PENDING'`, [leg.sure, leg.id]);
        if (r.rowCount) { affected.add(leg.bet_id); console.log(`[early-loss] leg ${leg.id} (${leg.market_name} / ${leg.selection_name}) closed ${leg.sure} at ${leg.lh}-${leg.la}`); }
        earlyLossSeen.delete(leg.id);
      }
      for (const betId of affected) await recomputeBetStatus(betId, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return { settledLegs: lostNow.length, recomputedBets: affected.size };
  } finally {
    client.release();
  }
}
