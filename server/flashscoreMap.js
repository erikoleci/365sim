// Flashscore (self-hosted scraper service, see flashscore-service/) -> our data shapes. Pure functions, no network, no database.
// Output conventions are the ones the other sources already use in match_events: GOAL rows carry the team NAME and the running
// score ("2-1"); PENALTY / YELLOW_CARD / RED_CARD rows carry 'home' / 'away' and a running count per side.
import { sameTeam } from './fixtureDedupe.js';

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
        status: m.status || null, round: m.round || null, note: m.note || null,
        competition: (g.competition && g.competition.name) || null,
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
  for (const p of (summary && summary.periods) || []) for (const inc of p.incidents || []) list.push(inc);
  for (const inc of list) {
    const side = inc.team === 'home' || inc.team === 'away' ? inc.team : null;
    if (!side) continue;
    const type = String(inc.type || '');
    const minute = minuteOf(inc);
    const half = minute != null && minute > 45 ? 2 : 1;
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
    } else if (has(type, /yellow card/i)) {
      count.YELLOW_CARD[side]++; rows.push({ minute, type: 'YELLOW_CARD', team: side, player, detail: String(count.YELLOW_CARD[side]), half });
    }
  }
  const sh = Number(fixture && fixture.homeScore); const sa = Number(fixture && fixture.awayScore);
  if (Number.isFinite(sh) && Number.isFinite(sa) && (h !== sh || a !== sa)) return null;
  return rows;
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

// The Flashscore match that is OUR match: same home/away order, kickoff within 3 hours, exactly one candidate.
export function findFlashscoreMatch(list, row) {
  const t = Date.parse(row.start_time);
  if (!Number.isFinite(t)) return null;
  const c = list.filter((f) => Math.abs(f.start - t) <= 3 * 3600 * 1000 && sameTeam(row.home_team, f.home) && sameTeam(row.away_team, f.away));
  return c.length === 1 ? c[0] : null;
}
