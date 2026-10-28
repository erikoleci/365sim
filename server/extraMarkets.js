// Settlement rules for the provider's less common markets (names exactly as the feed sends them).
// "Pritesi" = home side, "Udhëtuesi" = away side, 1 / X / 2 = home / draw / away.
//
// extraMarketOutcome(leg, normalisedMarketName, ctx) -> 'WON' | 'LOST' | 'VOID' | null | undefined
//   undefined = not one of these markets (the caller carries on with its own rules)
//   null      = it IS one of these markets but cannot be decided safely (stays PENDING)
// Everything is decided from the final score, the half-time score and the match counters; nothing
// is guessed: a missing half-time score / counter, an unknown option or a quarter line gives null.

import { asianHandicapOutcome, asianTotalOutcome } from './asianLines.js';
import { parseCountSelection, parseDoubleChance } from './selectionParse.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const fin = (v) => (v == null || v === '' ? NaN : Number(v));

const resultOf = (h, a) => (h > a ? '1' : h < a ? '2' : 'X');
const won = (b) => (b ? 'WON' : 'LOST');
const yesNo = (sel) => (/^(po|yes|gol)$/.test(sel) ? true : /^(jo|no|jogol)$/.test(sel) ? false : null);

function parseOU(sel) {
  const m = sel.match(/^(lart|mbi|over|poshte|nen|under)\s*(\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  return { over: /^(lart|mbi|over)$/.test(m[1]), line: parseFloat(m[2].replace(',', '.')) };
}
// Whole and half lines only. A push on a whole line is refunded; quarter lines (0.25 / 0.75) pay half
// of the stake each way, which this system does not do: they stay PENDING.
function ouOutcome(o, value) {
  if (!o || !Number.isFinite(value) || !Number.isInteger(o.line * 2)) return null;
  if (value === o.line) return 'VOID';
  return won(o.over ? value > o.line : value < o.line);
}
// "2-3", "5+", "+5", "3" (exactly 3), "-2" (at most 2) -> [lo, hi] | null
const rangeOf = (sel) => parseCountSelection(sel);
const inRange = (v, r) => !!r && Number.isFinite(v) && v >= r[0] && v <= r[1];
const scoreOf = (t) => { const m = t.match(/^(\d+)\s*[:-]\s*(\d+)$/); return m ? [Number(m[1]), Number(m[2])] : null; };
// A 1 / X / 2 or a double chance ("1x", "x-2", "Barazim ose 2", "Alpha ose Barazim") against a result.
const dcWon = (sel, res, leg) => {
  if (/^[12x]$/.test(sel)) return won(sel.toUpperCase() === res);
  const dc = parseDoubleChance(sel, { home: leg && leg.match_home, away: leg && leg.match_away });
  return dc ? won(dc.includes(res)) : null;
};

function halves(c) {
  const { homeScore: fh, awayScore: fa, htHome, htAway } = c;
  if (![fh, fa, htHome, htAway].every(Number.isFinite)) return null;
  const h2 = { home: fh - htHome, away: fa - htAway };
  if (h2.home < 0 || h2.away < 0) return null;
  return { h1: { home: htHome, away: htAway }, h2 };
}
const finalScore = (c) => (Number.isFinite(c.homeScore) && Number.isFinite(c.awayScore) ? { home: c.homeScore, away: c.awayScore } : null);
const half = (c, n) => { const h = halves(c); return h ? (String(n) === '1' ? h.h1 : h.h2) : null; };
const isHome = (w) => /^(home|pritesi|pritesi fiton)/.test(w);

// European handicap: "1 0:1" = home starts with 0, away with 1 goal (the number before the colon is
// the home team's head start), then 1 / X / 2 is read on the adjusted score.
function europeanHandicap(sel, s) {
  const m = sel.match(/^([1x2])\s+(\d+):(\d+)$/);
  if (!m || !s) return null;
  return won(resultOf(s.home + Number(m[2]), s.away + Number(m[3])) === m[1].toUpperCase());
}
// Asian handicap: "1 -0.5" = home with a -0.5 line, "2 +1" = away with +1 (own side + its line).
// Quarter lines split the stake over the two neighbouring lines (see asianLines.js).
function asianHandicap(sel, s) {
  const m = sel.match(/^([12])\s*([+-]?\d+(?:[.,]\d+)?)$/);
  if (!m || !s) return null;
  const line = parseFloat(m[2].replace(',', '.'));
  return m[1] === '1' ? asianHandicapOutcome(s.home, s.away, line) : asianHandicapOutcome(s.away, s.home, line);
}
function asianTotal(sel, total) {
  const o = parseOU(sel);
  return o && Number.isFinite(total) ? asianTotalOutcome(o.over, o.line, total) : null;
}


// ---- markets whose exact meaning is not confirmed: settled ONLY when every plausible reading agrees ----
// (a reading that disagrees leaves the ticket PENDING; nothing is guessed).
function unanimous(outcomes) {
  if (outcomes.some((o) => o == null)) return null;
  return outcomes.every((o) => o === outcomes[0]) ? outcomes[0] : null;
}
const dnb = (sel, a, b) => { // draw no bet on a score pair: 1 / 2, a draw refunds
  if (!/^[12]$/.test(sel)) return null;
  if (a === b) return 'VOID';
  return won((sel === '1') === (a > b));
};
const winsHalf = (sel, a, b) => (a === b ? null : won((sel === '1') === (a > b))); // draw loses (no refund): null here = readings differ

// Booking value of a team / the match. A booking can be a card count (yellow 1, red 1) or booking
// points (yellow 10, red 25); the size of the line or option tells which unit the market uses.
// The first scheme of each unit is the one used (card count: yellow 1 / red 1; points: yellow 10 / red 25).
const COUNT_SCHEMES = [{ y: 1, r: 1 }];
const POINT_SCHEMES = [{ y: 10, r: 25 }];
const schemesFor = (n) => (n >= 10 ? POINT_SCHEMES : COUNT_SCHEMES);
function bookingParts(c, firstHalf) {
  const st = c.stats; if (!st) return null;
  let yh = fin(st.yellowHome); let ya = fin(st.yellowAway); let rh = fin(st.redHome); let ra = fin(st.redAway);
  if (firstHalf) { // counters at the whistle: cards = yellow + red
    const ht = c.htStats; if (!ht) return null;
    rh = fin(ht.redHome); ra = fin(ht.redAway);
    yh = fin(ht.cardsHome) - rh; ya = fin(ht.cardsAway) - ra;
  }
  return [yh, ya, rh, ra].every((v) => Number.isFinite(v) && v >= 0) ? { yh, ya, rh, ra } : null;
}
const bookingValues = (b, which, schemes) => schemes.map((k) => {
  const home = b.yh * k.y + b.rh * k.r; const away = b.ya * k.y + b.ra * k.r;
  return which === 'home' ? home : which === 'away' ? away : home + away;
});

const RULES = [
  // ---- goals in one half ----
  [/^sa gola shenohen ne pjesen e ([12])\w*$/, (m, sel, c) => { const p = half(c, m[1]); return p ? ouOutcome(parseOU(sel), p.home + p.away) : null; }],
  [/^sa gola shenon (pritesi|udhetuesi) ne pjesen e ([12])\w*$/, (m, sel, c) => { const p = half(c, m[2]); return p ? ouOutcome(parseOU(sel), isHome(m[1]) ? p.home : p.away) : null; }],
  [/^sasia (?:e )?golave ne pjesen e ([12])\w*$/, (m, sel, c) => { const p = half(c, m[1]); const r = rangeOf(sel); return p && r ? won(inRange(p.home + p.away, r)) : null; }],
  [/^(?:sasia e golave perfundimtare|shuma e sakte e golave ne ndeshje)$/, (m, sel, c) => { const s = finalScore(c); const r = rangeOf(sel); return s && r ? won(inRange(s.home + s.away, r)) : null; }],
  [/^(home|away) multigoals$/, (m, sel, c) => { const s = finalScore(c); const r = rangeOf(sel); return s && r ? won(inRange(m[1] === 'home' ? s.home : s.away, r)) : null; }],
  [/^gol-jo gol ne pjesen e ([12])\w*$/, (m, sel, c) => { const p = half(c, m[1]); const y = yesNo(sel); return p && y !== null ? won((p.home > 0 && p.away > 0) === y) : null; }],
  [/^(pritesi|udhetuesi) shenon ne te dy pjeset$/, (m, sel, c) => { const h = halves(c); const y = yesNo(sel); if (!h || y === null) return null; const k = isHome(m[1]) ? 'home' : 'away'; return won((h.h1[k] > 0 && h.h2[k] > 0) === y); }],
  [/^(home|away) highest scoring half$/, (m, sel, c) => {
    const h = halves(c); if (!h) return null;
    const k = m[1]; const a = h.h1[k]; const b = h.h2[k];
    const actual = a > b ? '1st' : b > a ? '2nd' : 'equal';
    return /^(1st|2nd|equal)$/.test(sel) ? won(sel === actual) : null;
  }],
  [/^(?:(1st|2nd) half - )?(home|away) clean sheet$/, (m, sel, c) => {
    const y = yesNo(sel); if (y === null) return null;
    const p = m[1] ? half(c, m[1] === '1st' ? 1 : 2) : finalScore(c);
    if (!p) return null;
    const conceded = m[2] === 'home' ? p.away : p.home;
    return won((conceded === 0) === y);
  }],
  [/^(pritesi|udhetuesi) fiton me zero$/, (m, sel, c) => { const s = finalScore(c); const y = yesNo(sel); if (!s || y === null) return null; const h = isHome(m[1]); return won(((h ? s.home > s.away && s.away === 0 : s.away > s.home && s.home === 0)) === y); }],
  [/^(home|away) to win either half$/, (m, sel, c) => { const h = halves(c); const y = yesNo(sel); if (!h || y === null) return null; const k = m[1], o = k === 'home' ? 'away' : 'home'; return won((h.h1[k] > h.h1[o] || h.h2[k] > h.h2[o]) === y); }],
  [/^(pritesi|udhetuesi) fiton te dy pjeset$/, (m, sel, c) => { const h = halves(c); const y = yesNo(sel); if (!h || y === null) return null; const k = isHome(m[1]) ? 'home' : 'away', o = k === 'home' ? 'away' : 'home'; return won((h.h1[k] > h.h1[o] && h.h2[k] > h.h2[o]) === y); }],
  [/^ne cilen pjese do te shenohen me shume gola$/, (m, sel, c) => {
    const h = halves(c); if (!h) return null;
    const a = h.h1.home + h.h1.away; const b = h.h2.home + h.h2.away;
    const pick = /^(pjesen e 1re|pjesen e pare|pjesa e pare|pj1|1st|1)$/.test(sel) ? 'a' : /^(pjesen e 2te|pjesen e dyte|pjesa e dyte|pj2|2nd|2)$/.test(sel) ? 'b' : /^(barazim|x|equal)$/.test(sel) ? 'eq' : null;
    if (!pick) return null;
    return won(pick === (a > b ? 'a' : b > a ? 'b' : 'eq'));
  }],
  [/^tek\/cift pjesa e ([12])\w*$/, (m, sel, c) => { const p = half(c, m[1]); if (!p || !/^(tek|cift)$/.test(sel)) return null; return won(((p.home + p.away) % 2 === 1) === (sel === 'tek')); }],

  // ---- results ----
  [/^(home|away|any team) to win$/, (m, sel, c, leg) => { const s = finalScore(c); return s ? dcWon(sel, resultOf(s.home, s.away), leg) : null; }],
  [/^dopio shans - pjesa ([12])\w*$/, (m, sel, c, leg) => { const p = half(c, m[1]); return p ? dcWon(sel, resultOf(p.home, p.away), leg) : null; }],
  [/^dopio ?shans live$/, (m, sel, c, leg) => { const s = finalScore(c); return s ? dcWon(sel, resultOf(s.home, s.away), leg) : null; }],
  [/^rezultati i pjeses se dyte$/, (m, sel, c) => { const p = half(c, 2); return p && /^[1x2]$/.test(sel) ? won(resultOf(p.home, p.away) === sel.toUpperCase()) : null; }],
  [/^(barazim|fiton pritesi|fiton udhetuesi) ose (0-2 ?gola|3\+|gol\/jogol)$/, (m, sel, c) => {
    const s = finalScore(c); const y = yesNo(sel); if (!s || y === null) return null;
    const res = resultOf(s.home, s.away);
    const first = m[1] === 'barazim' ? res === 'X' : m[1] === 'fiton pritesi' ? res === '1' : res === '2';
    const total = s.home + s.away;
    const second = m[2] === '3+' ? total >= 3 : m[2] === 'gol/jogol' ? s.home > 0 && s.away > 0 : total <= 2;
    return won((first || second) === y);
  }],
  // "1X_0-1", "x2_+3", "X2 & 3+", "1x/2-3": the double chance and the goal range must both hold.
  [/^dopio shans me kombinime$/, (m, sel, c, leg) => {
    const s = finalScore(c); const p = sel.match(/^(1x|x1|x2|2x|12|21)\s*(?:_|&|\/|\+|-|\bdhe\b|\s)\s*(.+)$/); if (!s || !p) return null;
    const r = rangeOf(p[2]); if (!r) return null;
    return won(dcWon(p[1], resultOf(s.home, s.away), leg) === 'WON' && inRange(s.home + s.away, r));
  }],
  [/^rezultat final\/gol-jo gol$/, (m, sel, c) => {
    const s = finalScore(c); const p = sel.match(/^([1x2])\/(gol|jogol)$/); if (!s || !p) return null;
    return won(resultOf(s.home, s.away) === p[1].toUpperCase() && (s.home > 0 && s.away > 0) === (p[2] === 'gol'));
  }],
  [/^lart-poshte\/gol-jo gol$/, (m, sel, c) => {
    const s = finalScore(c); const p = sel.match(/^(gol|jogol)\/(.+)$/); if (!s || !p) return null;
    const r = rangeOf(p[2]); if (!r) return null;
    return won((s.home > 0 && s.away > 0) === (p[1] === 'gol') && inRange(s.home + s.away, r));
  }],

  // "<result> OR any clean sheet": OR of the two conditions (Yes wins when either holds).
  [/^(home|away|draw) or any clean sheet$/, (m, sel, c) => {
    const s = finalScore(c); const y = yesNo(sel); if (!s || y === null) return null;
    const res = resultOf(s.home, s.away);
    const first = m[1] === 'home' ? res === '1' : m[1] === 'away' ? res === '2' : res === 'X';
    return won((first || s.home === 0 || s.away === 0) === y);
  }],
  // Booking 1X2: the side with more cards. Decided only when NO red card was shown by either team:
  // then comparing yellow counts gives the same answer whether the provider counts cards or
  // booking points (10 per yellow). With a red card the two schemes can differ -> PENDING.
  [/^(?:(1st half) - )?booking 1x2$/, (m, sel, c) => {
    if (!/^[1x2]$/.test(sel)) return null;
    const b = bookingParts(c, !!m[1]); if (!b) return null;
    const [home] = bookingValues(b, 'home', POINT_SCHEMES); const [away] = bookingValues(b, 'away', POINT_SCHEMES);
    return won(resultOf(home, away) === sel.toUpperCase());
  }],
  // "Rezultati Final Gola 3+" / "4+": the final result AND at least N goals (1 / X / 2 options);
  // with Po/Jo options only the goals condition.
  [/^rezultati final gola (\d+)\+$/, (m, sel, c) => {
    const s = finalScore(c); if (!s) return null;
    const enough = s.home + s.away >= Number(m[1]);
    if (/^[1x2]$/.test(sel)) return won(resultOf(s.home, s.away) === sel.toUpperCase() && enough);
    const y = yesNo(sel); return y === null ? null : won(enough === y);
  }],

  // ---- "Fitore/Fitore" (options 1 / 2) and its half variants ----
  // Read as draw no bet (like the 1st / 2nd half versions the provider lists next to the other
  // standard markets): the chosen team wins -> WON, the other wins -> LOST, a draw -> refunded.
  [/^fitore ?\/ ?fitore$/, (m, sel, c) => { const s = finalScore(c); return s ? dnb(sel, s.home, s.away) : null; }],
  [/^(?:fitore ?\/ ?fitore - pjesa ([12])\w*|fitore - fitore pjesa e? ?([12])\w*)$/, (m, sel, c) => {
    const p = half(c, m[1] || m[2]); return p ? dnb(sel, p.home, p.away) : null;
  }],

  // "Halftime/fulltime & exact goals": option = half-time result, full-time result, then the goals
  // ("1/1 & 3", "2-X/0-1", "1-1 2+"): all three must be right.
  [/^halftime\/fulltime & exact goals$/, (m, sel, c) => {
    const s = finalScore(c); const h = halves(c); if (!s || !h) return null;
    // "1/1 & 3", "2-X/0-1", "1-1 2+", "x-2/+3": the pair first, then the goal count in any accepted spelling
    const o = sel.match(/^([1x2])\s*[-\/]\s*([1x2])\s*(?:&|\/|_|-|\s)\s*(.+)$/);
    const r = o && rangeOf(o[3]);
    if (!o || !r) return null;
    return won(resultOf(h.h1.home, h.h1.away) === o[1].toUpperCase() && resultOf(s.home, s.away) === o[2].toUpperCase() && inRange(s.home + s.away, r));
  }],
  // "RP1/RP2 & Gol/JoGol": result of the first half, result of the second half, and both teams to score.
  [/^rp1\/rp2 & gol\/jogol$/, (m, sel, c) => {
    const s = finalScore(c); const h = halves(c); if (!s || !h) return null;
    const o = sel.match(/^([1x2])\s*[-\/]\s*([1x2])\s*(?:&|\/|_|-|\s)\s*(gol|jogol)$/);
    if (!o) return null;
    return won(resultOf(h.h1.home, h.h1.away) === o[1].toUpperCase() && resultOf(h.h2.home, h.h2.away) === o[2].toUpperCase() && (s.home > 0 && s.away > 0) === (o[3] === 'gol'));
  }],
  // Second-half red cards = full-time counters minus those taken at the whistle.
  [/^2nd half - (?:(home|away) )?sending off$/, (m, sel, c) => {
    const y = yesNo(sel); if (y === null || !c.stats || !c.htStats) return null;
    const f = (k) => fin(c.stats[k]) - fin(c.htStats[k]);
    const h = f('redHome'); const a = f('redAway');
    if (!Number.isFinite(h) || !Number.isFinite(a) || h < 0 || a < 0) return null;
    const n = m[1] === 'home' ? h : m[1] === 'away' ? a : h + a;
    return won((n > 0) === y);
  }],

  // ---- bookings (see the note at COUNT_SCHEMES) ----
  [/^(?:(1st half) - )?total bookings$/, (m, sel, c) => {
    const o = parseOU(sel); const b = bookingParts(c, !!m[1]); if (!o || !b) return null;
    return bookingValues(b, 'both', schemesFor(o.line)).map((v) => (v === o.line ? 'VOID' : won(o.over ? v > o.line : v < o.line)))[0];
  }],
  [/^(?:(1st half) - )?(home|away) exact bookings$/, (m, sel, c) => {
    const r = rangeOf(sel); const b = bookingParts(c, !!m[1]); if (!r || !b) return null;
    const unit = Number.isFinite(r[1]) ? r[1] : r[0];
    return bookingValues(b, m[2], schemesFor(unit)).map((v) => won(inRange(v, r)))[0];
  }],
  // "Rezultat Final me Kartona" / "Rezultat i P1 me kartona": a 1 / X / 2 and an over / under on the
  // bookings in one option ("1 & Lart 3.5"; the separator may be &, /, - or a space).
  [/^(?:rezultat final me kartona|rezultat i p1 me kartona)$/, (m, sel, c, leg) => {
    const first = /p1/.test(norm(leg.market_name));
    const o = sel.match(/^([1x2])\s*(?:&|\/|-|_|\s)\s*((?:lart|poshte|nen|mbi|over|under)\s*\d+(?:[.,]\d+)?)$/);
    const sc = first ? half(c, 1) : finalScore(c); const b = bookingParts(c, first);
    if (!o || !sc || !b) return null;
    const ou = parseOU(o[2]); if (!ou) return null;
    if (resultOf(sc.home, sc.away) !== o[1].toUpperCase()) return 'LOST';
    return bookingValues(b, 'both', schemesFor(ou.line)).map((v) => (v === ou.line ? 'VOID' : won(ou.over ? v > ou.line : v < ou.line)))[0];
  }],

  // ---- handicaps ----
  [/^handikap europian(?: - pjesa ([12])\S*| pjesa ([12])\S*)?$/, (m, sel, c) => { const n = m[1] || m[2]; return europeanHandicap(sel, n ? half(c, n) : finalScore(c)); }],
  [/^handikap aziatik$/, (m, sel, c) => asianHandicap(sel, finalScore(c))],
  [/^(?:handikap aziatik pjesa|handikap - pjesa) ([12])\S*$/, (m, sel, c) => asianHandicap(sel, half(c, m[1]))],
  [/^lart\/poshtë? ?gola aziatike$|^lart\/poshte gola aziatike$/, (m, sel, c) => { const s = finalScore(c); return s ? asianTotal(sel, s.home + s.away) : null; }],
  [/^lart\/poshte gola aziatik ne pjesen ([12])$/, (m, sel, c) => { const p = half(c, m[1]); return p ? asianTotal(sel, p.home + p.away) : null; }],

  // ---- correct score of a half / half + final ----
  [/^rezultat i sakte pjesa - 2te$/, (m, sel, c) => { const p = half(c, 2); const sc = scoreOf(sel); return p && sc ? won(p.home === sc[0] && p.away === sc[1]) : null; }],
  [/^rezultati i sakte i pjeses se 1re$/, (m, sel, c) => {
    const p = half(c, 1); if (!p) return null;
    // "Te Tjera" (any other score) = anything outside the usual grid of half-time scores up to 2:2
    if (/^te tjera$/.test(sel)) return won(p.home > 2 || p.away > 2);
    const sc = scoreOf(sel);
    return sc ? won(p.home === sc[0] && p.away === sc[1]) : null;
  }],
  [/^rezultat i sakte pjesa 1\/final$/, (m, sel, c) => {
    const h = halves(c); const s = finalScore(c); const p = sel.match(/^(\d+\s*[:-]\s*\d+)\s+(\d+\s*[:-]\s*\d+)$/);
    if (!h || !s || !p) return null;
    const a = scoreOf(p[1]); const b = scoreOf(p[2]);
    return won(h.h1.home === a[0] && h.h1.away === a[1] && s.home === b[0] && s.away === b[1]);
  }],
  [/^rezultati sakte live$/, (m, sel, c) => { const s = finalScore(c); const sc = scoreOf(sel); return s && sc ? won(s.home === sc[0] && s.away === sc[1]) : null; }],

  // ---- red cards / corners ----
  // Red cards: whole match from the match counters, "1st half" from the counters taken at the whistle
  // (matches_cache.ht_red_*, filled once per match at half-time).
  [/^(?:(1st half) - )?(?:(home|away) )?sending off$/, (m, sel, c) => {
    const y = yesNo(sel); const st = m[1] ? c.htStats : c.stats; if (y === null || !st) return null;
    const h = fin(st.redHome); const a = fin(st.redAway);
    if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
    const n = m[2] === 'home' ? h : m[2] === 'away' ? a : h + a;
    return won((n > 0) === y);
  }],
  [/^(?:(1st half) - )?corner 1x2$/, (m, sel, c) => {
    if (!/^[1x2]$/.test(sel) || !c.stats) return null;
    let h = fin(c.stats.cornersHome); let a = fin(c.stats.cornersAway);
    if (m[1]) { // first half: counters at the whistle
      if (!c.htStats) return null;
      h = fin(c.htStats.cornersHome); a = fin(c.htStats.cornersAway);
    }
    if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
    return won(resultOf(h, a) === sel.toUpperCase());
  }],
];

// "pjesen e pare / pjeses se dyte / pjesa e parë" -> "pjesen e 1 / pjesen e 2": the same half is
// spelled with words or digits depending on the market, and the rules above key on the digit.
const canon = (name) => String(name)
  .replace(/\bpjes(a|en|es|e)\s+(s?e\s+)?pare\b/g, (_, f, e) => `pjes${f} ${e || ''}1`.replace(/\s+/g, ' '))
  .replace(/\bpjes(a|en|es|e)\s+(s?e\s+)?dyte\b/g, (_, f, e) => `pjes${f} ${e || ''}2`.replace(/\s+/g, ' '));

export function matchExtraMarket(nameNorm) {
  const n = canon(nameNorm);
  return RULES.some(([re]) => re.test(n));
}

export function extraMarketOutcome(leg, marketName, ctx) {
  const name = canon(marketName);
  for (const [re, run] of RULES) {
    const m = name.match(re);
    if (m) return run(m, norm(leg.selection_name || leg.selection_id), ctx || {}, leg) ?? null;
  }
  return undefined;
}

// Names the feed sends that look settleable but are NOT (they need event order / data we do not
// have), so the coverage report must not claim a rule for them.
export const UNSETTLEABLE_NAME = new RegExp([
  // the feed gives no penalty events: decided by hand in the admin "Pezull" tab (or refunded)
  'penallti',
].join('|'));
