// Flashscore (self-hosted scraper service, see flashscore-service/) -> our data shapes. Pure functions, no network, no database.
// Output conventions are the ones the other sources already use in match_events: GOAL rows carry the team NAME and the running
// score ("2-1"); PENALTY / YELLOW_CARD / RED_CARD rows carry 'home' / 'away' and a running count per side.
import { sameTeam } from './fixtureDedupe.js';
import { looseSameClub } from './fixtureLink.js';

const minuteOf = (inc) => {
  const n = Number(inc && inc.minute_number);
  if (Number.isFinite(n)) return n;
  const m = /(\d+)/.exec(String((inc && inc.minute) || ''));
  return m ? Number(m[1]) : null;
};
const has = (s, re) => re.test(String(s || ''));

// /matches?sport=football&day=N -> flat list of fixtures {id, start(ms), home, away, homeScore, awayScore, status, round, note, competition}
export function parseMatchList(json) {
  const out = [];
  for (const g of (json && json.competitions) || []) {
    for (const m of (g && g.matches) || []) {
      const start = Date.parse(m.start_time);
      if (!m.id || !Number.isFinite(start) || !m.home || !m.away || !m.home.name || !m.away.name) continue;
      out.push({
        id: String(m.id), start, home: m.home.name, away: m.away.name,
        homeScore: m.home_score ?? null, awayScore: m.away_score ?? null,
        status: m.status || null, stage: m.stage || null, stageId: m.stage_id ?? null, round: m.round || null, note: m.note || null,
        competition: (g.competition && g.competition.name) || null,
        homeLogo: (m.home && m.home.logo) || null, awayLogo: (m.away && m.away.logo) || null,
      });
    }
  }
  return out;
}

// /matches/summary -> match_events rows. Returns null when the goals do not add up to the score Flashscore reports for the match
// (a timeline that contradicts the score is worse than none), exactly like the API-Football source.
export function incidentRows(summary, fixture, ourHome, ourAway) {
  const rows = [];
  let h = 0; let a = 0;
  const count = { PENALTY: { home: 0, away: 0 }, YELLOW_CARD: { home: 0, away: 0 }, RED_CARD: { home: 0, away: 0 } };
  const list = [];
  for (const p of (summary && summary.periods) || []) for (const inc of p.incidents || []) list.push({ ...inc, __period: p.period });
  for (const inc of list) {
    const side = inc.team === 'home' || inc.team === 'away' ? inc.team : null;
    if (!side) continue;
    const type = String(inc.type || '');
    const minute = minuteOf(inc);
    // The half comes from the PERIOD Flashscore files the incident under (a goal in first-half stoppage time, 45+3, is still the first half);
    // only when the period is unknown does the minute decide.
    const per = String(inc.__period || '');
    const half = /^1st/i.test(per) ? 1 : /^2nd/i.test(per) ? 2 : (minute != null && minute > 45 ? 2 : 1);
    const player = (inc.player && inc.player.name) || null;
    const text = `${type} ${inc.reason || ''} ${inc.description || ''}`;
    const ownGoal = has(type, /own goal/i) || has(inc.reason, /own goal/i);
    if (has(type, /^goal$|^penalty goal$|own goal/i) || (has(type, /goal/i) && !has(type, /disallowed|cancel|no goal/i))) {
      if (has(type, /disallowed|cancel/i)) continue;
      const scoring = ownGoal ? (side === 'home' ? 'away' : 'home') : side;
      if (scoring === 'home') h++; else a++;
      if (has(text, /penalty/i)) { count.PENALTY[scoring]++; rows.push({ minute, type: 'PENALTY', team: scoring, player, detail: String(count.PENALTY[scoring]), half }); }
      rows.push({ minute, type: 'GOAL', team: scoring === 'home' ? ourHome : ourAway, player: ownGoal ? (player ? `${player} (a.g.)` : '(a.g.)') : player, detail: `${h}-${a}`, half });
    } else if (has(type, /penalty/i) && has(text, /miss|saved|hit the|wide|over the bar/i)) {
      count.PENALTY[side]++; rows.push({ minute, type: 'PENALTY', team: side, player, detail: String(count.PENALTY[side]), half });
    } else if (has(type, /red card/i) || has(type, /yellow.*red|second yellow/i)) {
      const second = has(type, /yellow.*red|second yellow/i);
      if (second) { count.YELLOW_CARD[side]++; rows.push({ minute, type: 'YELLOW_CARD', team: side, player, detail: String(count.YELLOW_CARD[side]), half }); }
      count.RED_CARD[side]++; rows.push({ minute, type: 'RED_CARD', team: side, player, detail: String(count.RED_CARD[side]), half });
    } else if (has(type, /^substitution/i)) {
      // the scraper (patched copy in flashscore-service/) attaches the player coming ON to the "Out" record; both names or nothing
      const inName = inc.substituted_in && inc.substituted_in.name;
      if (has(type, /out/i) && inName && player) rows.push({ minute, type: 'SUBSTITUTION', team: side, player: inName, detail: player, half });
    } else if (has(type, /yellow card/i)) {
      count.YELLOW_CARD[side]++; rows.push({ minute, type: 'YELLOW_CARD', team: side, player, detail: String(count.YELLOW_CARD[side]), half });
    }
  }
  // The reference score: what Flashscore's list says; when the list has no score (null), the running score printed on the last goal
  // of the incident list itself. With neither, nothing is logged (never a timeline that cannot be checked against a score).
  const num = (v) => (v == null || v === '' ? NaN : Number(v));
  let sh = num(fixture && fixture.homeScore); let sa = num(fixture && fixture.awayScore);
  if (!Number.isFinite(sh) || !Number.isFinite(sa)) {
    const goals = list.filter((i) => has(i.type, /goal/i) && !has(i.type, /disallowed|cancel/i) && Number.isFinite(num(i.home_score)) && Number.isFinite(num(i.away_score)));
    if (!goals.length) return h + a === 0 && list.length === 0 ? rows : null;
    const last = goals[goals.length - 1]; sh = num(last.home_score); sa = num(last.away_score);
  }
  if (h !== sh || a !== sa) return null;
  return rows;
}

// Statistics we do NOT already have from the main feed (it has possession, shots, corners, cards, xG, attacks): every other row of the
// whole-match period, as [{ name, home, away }] with the strings Flashscore prints ("81% (281/346)", "12"). Big chances included.
const HAVE = /^(ball possession|total shots|shots on target|shots off target|corner kicks|yellow cards|red cards|expected goals \(xg\)|attacks|dangerous attacks)$/i;
export function otherStats(stats) {
  const periods = (stats && stats.periods) || [];
  const whole = periods.find((p) => /^match$|^full/i.test(String(p.period || ''))) || periods[0];
  const out = [];
  for (const g of (whole && whole.groups) || []) for (const s of g.statistics || []) {
    const name = String(s.name || '').trim();
    if (!name || HAVE.test(name) || s.home == null || s.away == null) continue;
    out.push({ name: name.slice(0, 40), home: String(s.home).slice(0, 24), away: String(s.away).slice(0, 24) });
  }
  return out.slice(0, 40);
}

// /matches/statistics -> { home, away } big chances for the whole match (period "Match"/first period), or null when not published.
export function bigChances(stats) {
  const periods = (stats && stats.periods) || [];
  const whole = periods.find((p) => /^match$|^full/i.test(String(p.period || ''))) || periods[0]; // the feed lists the whole match first
  for (const g of (whole && whole.groups) || []) for (const s of g.statistics || []) {
    if (/^big chances?$/i.test(String(s.name || '').trim())) {
      const home = Number.isFinite(s.home_value) ? s.home_value : null; const away = Number.isFinite(s.away_value) ? s.away_value : null;
      if (home != null || away != null) return { home, away };
    }
  }
  return null;
}

// The Flashscore match that is OUR match, same home/away order, exactly one candidate.
// Pass 1: both names match and the kickoff is within 3 hours. Pass 2 (small leagues spell clubs differently: "Bengaluru B" /
// "Bengaluru FC B"): the kickoff must be within 10 minutes and both names must pass the looser club test. A swapped pair is never trusted.
export function findFlashscoreMatch(list, row) {
  const t = Date.parse(row.start_time);
  if (!Number.isFinite(t)) return null;
  const strict = list.filter((f) => Math.abs(f.start - t) <= 3 * 3600 * 1000 && sameTeam(row.home_team, f.home) && sameTeam(row.away_team, f.away));
  if (strict.length) return strict.length === 1 ? strict[0] : null;
  const loose = list.filter((f) => Math.abs(f.start - t) <= 10 * 60000 && looseSameClub(row.home_team, f.home) && looseSameClub(row.away_team, f.away));
  return loose.length === 1 ? loose[0] : null;
}

// One line for the log when the incidents do not add up: what we counted vs the reported score and the incident types seen.
export function incidentDiag(summary, fixture) {
  const types = {};
  let n = 0;
  for (const p of (summary && summary.periods) || []) for (const i of p.incidents || []) { n++; const k = String(i.type || '?'); types[k] = (types[k] || 0) + 1; }
  const t = Object.entries(types).map(([k, v]) => `${k}x${v}`).join(', ');
  return `list score ${fixture && fixture.homeScore}-${fixture && fixture.awayScore}; ${n} incidents (${t || 'none'})`;
}

// The match clock from Flashscore's STAGE (exact: 1st half / half time / 2nd half) plus the wall clock inside the stage (an estimate).
// Used only as a fallback when our own provider's clock has stopped. `seenSecondHalfAt` = when this process first saw the 2nd half
// (the start of the half is never later than that); without it the 2nd half is assumed to start 62 min after kickoff (45 + stoppage + break).
// Returns { status: 'live' | 'HT', minute } for the regular time, { status: 'ET' | 'AET' | 'PEN', closeOnly: true } for extra time / penalties, or null (finished, not started...).
export function flashscoreClock(f, now, seenSecondHalfAt = null) {
  if (!f || !Number.isFinite(f.start)) return null;
  const stage = String(f.stage || '').toLowerCase();
  const id = Number(f.stageId);
  if (id === 38 || stage === 'half time') return { status: 'HT', minute: '45' };
  if (id === 12 || stage === '1st half') {
    const m = Math.floor((now - f.start) / 60000) + 1;
    if (m < 1) return null;
    return { status: 'live', minute: m > 45 ? '45+' : String(m) };
  }
  if (id === 13 || stage === '2nd half') {
    const start2 = Number.isFinite(seenSecondHalfAt) ? Math.min(seenSecondHalfAt, now) : f.start + 62 * 60000;
    const m = 46 + Math.max(0, Math.floor((now - start2) / 60000));
    return { status: 'live', minute: m > 90 ? '90+' : String(m) };
  }
  // Extra time / penalties: CLOSING signals only (the app closes every market when live_status is ET / PEN / AET, see marketPeriods.js).
  if (id === 6 || stage === 'extra time') return { status: 'ET', minute: null, closeOnly: true };
  if (id === 10 || stage === 'after extra time') return { status: 'AET', minute: null, closeOnly: true };
  if (id === 7 || id === 11 || stage === 'penalties' || stage === 'after penalties') return { status: 'PEN', minute: null, closeOnly: true };
  return null;
}
