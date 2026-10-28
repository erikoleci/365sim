// The provider's own live-oriented markets (names exactly as the feed sends them, read from its site):
//   "Nr-Gola Pritesi / Udhetuesi"   exact goals of one team: 0 Gola | 1 Gol | 2 Gola | 3+ Gola
//   "Shenon Pritesi / Udhetuesi ne P2" (or P1, or P1/P2 = both halves)   Po / Jo: that team scores in that half
//   "Gol / Jo Gol Ne P1|P2"          both teams score in that half; the options are 1 = Gol, 2 = Jo Gol
//   "Rezultat Final/Gol-Gol"        final result | both teams score: 1|G  2|JG ...
//   "Goli i Pare|Dyte Shenohet perpara min. N:00"          Po / Jo: that goal (either team) before N:00
//   "Goli i Pare|Dyte i Pritesit|Udhetuesit perpara min. N:00"   the same for one team's goal
//   "RF-<N>Min"                     1 / X / 2: the score as it stood at N:00
//   "Rezultati Final Gola 3+ / 4+"  (settled in extraMarkets.js; only its in-play opening is here)
// "Pritesi" = home side, "Udhetuesi" = away side. Goal minutes are the provider's event labels
// (the minute in progress, floor(T/60)+1), so "before N:00" means a label <= N.
// providerOutcome returns 'WON' | 'LOST' | null (null = cannot be decided safely, stays PENDING).

const side = (w) => (/^pritesi/.test(w) ? 'HOME' : 'AWAY');

export function parseProviderMarket(nameNorm) {
  const n = String(nameNorm || '');
  let m = n.match(/^nr-gola (pritesi|udhetuesi)$/);
  if (m) return { type: 'team_goals', side: side(m[1]) };
  m = n.match(/^shenon (pritesi|udhetuesi) ne p([12])$/);
  if (m) return { type: 'team_scores', side: side(m[1]), half: Number(m[2]) };
  m = n.match(/^shenon (pritesi|udhetuesi) ne p1\s*\/\s*p2$/);
  if (m) return { type: 'team_scores', side: side(m[1]), half: 'both' }; // scores in both halves
  m = n.match(/^gol ?\/ ?jo ?gol ne p([12])$/);
  if (m) return { type: 'btts_half', half: Number(m[1]) };
  if (n === 'rezultat final/gol-gol') return { type: 'result_btts' };
  m = n.match(/^goli i (pare|dyte) shenohet perpara min\.? (\d+):00$/);
  if (m) return { type: 'goal_before', k: m[1] === 'pare' ? 1 : 2, side: null, minute: Number(m[2]) };
  m = n.match(/^goli i (pare|dyte) i (pritesit|udhetuesit) perpara min\.? (\d+):00$/);
  if (m) return { type: 'goal_before', k: m[1] === 'pare' ? 1 : 2, side: side(m[2]), minute: Number(m[3]) };
  m = n.match(/^rf-(\d+)min$/);
  if (m) return { type: 'rf_at', minute: Number(m[1]) };
  if (/^rezultati final gola \d+\+$/.test(n)) return { type: 'result_goals' };
  return null;
}

const res = (h, a) => (h > a ? '1' : h < a ? '2' : 'x');
const won = (b) => (b ? 'WON' : 'LOST');
const yesNo = (sel) => (/^(po|yes)$/.test(sel) ? true : /^(jo|no)$/.test(sel) ? false : null);

// goals of one team for "Nr-Gola": the option is "0 Gola", "1 Gol", "2 Gola", "3+ Gola"
export function teamGoalsOption(sel) {
  const m = String(sel || '').match(/^(\+?)(\d+)(\+?)\s*gol/); // "3+ Gola" and "+3 Gola"
  return m ? { n: Number(m[2]), plus: m[1] === '+' || m[3] === '+' } : null;
}

// ctx: { homeScore, awayScore, htHome, htAway, goalTimeline }
//   goalTimeline = [{ minute, side }] sorted, only when complete and every minute is exact
export function providerOutcome(spec, sel, ctx) {
  const { homeScore: fh, awayScore: fa, htHome, htAway, goalTimeline } = ctx;
  switch (spec.type) {
    case 'team_goals': {
      const o = teamGoalsOption(sel); const g = spec.side === 'HOME' ? fh : fa;
      if (!o || !Number.isFinite(g)) return null;
      return won(o.plus ? g >= o.n : g === o.n);
    }
    case 'team_scores': {
      const y = yesNo(sel);
      if (y === null || ![fh, fa, htHome, htAway].every(Number.isFinite)) return null;
      const g1 = spec.side === 'HOME' ? htHome : htAway;
      const g2 = (spec.side === 'HOME' ? fh : fa) - g1;
      if (g2 < 0) return null;
      const yes = spec.half === 'both' ? g1 > 0 && g2 > 0 : spec.half === 1 ? g1 > 0 : g2 > 0;
      return won(yes === y);
    }
    case 'btts_half': {
      const y = yesNo(sel) ?? (sel === '1' ? true : sel === '2' ? false : yesNo(sel === 'gol' ? 'po' : sel === 'jogol' ? 'jo' : sel));
      if (y === null || ![fh, fa, htHome, htAway].every(Number.isFinite)) return null;
      const h = spec.half === 1 ? htHome : fh - htHome;
      const a = spec.half === 1 ? htAway : fa - htAway;
      if (h < 0 || a < 0) return null;
      return won((h > 0 && a > 0) === y);
    }
    case 'result_btts': {
      const o = String(sel).match(/^([12x])\s*\|\s*(jg|g)$/);
      if (!o || !Number.isFinite(fh) || !Number.isFinite(fa)) return null;
      return won(res(fh, fa) === o[1] && (fh > 0 && fa > 0) === (o[2] === 'g'));
    }
    case 'goal_before': {
      const y = yesNo(sel);
      if (y === null || !goalTimeline) return null;
      const goals = spec.side ? goalTimeline.filter((g) => g.side === spec.side) : goalTimeline;
      const happened = goals.length >= spec.k && goals[spec.k - 1].minute <= spec.minute;
      return won(happened === y);
    }
    case 'rf_at': {
      if (!goalTimeline || !/^[12x]$/.test(sel)) return null;
      const upTo = goalTimeline.filter((g) => g.minute <= spec.minute);
      return won(res(upTo.filter((g) => g.side === 'HOME').length, upTo.filter((g) => g.side === 'AWAY').length) === sel);
    }
    default:
      return undefined; // result_goals: decided by extraMarkets.js
  }
}

// Builds the timeline from match_events GOAL rows; undefined when it cannot be trusted
// (events missing, or a minute that is not the exact clock reading).
export function goalTimelineFromRows(rows, homeTeam, awayTeam, homeScore, awayScore) {
  if (![homeScore, awayScore].every(Number.isFinite)) return undefined;
  if (homeScore + awayScore === 0) return [];
  if (!rows || rows.length !== homeScore + awayScore) return undefined;
  const out = [];
  for (const r of rows) {
    const minute = Number(r.minute);
    const s = r.team === 'home' || r.team === homeTeam ? 'HOME' : r.team === 'away' || r.team === awayTeam ? 'AWAY' : null;
    if (r.minute_exact !== true || r.minute == null || !Number.isFinite(minute) || !s) return undefined;
    out.push({ minute, side: s });
  }
  if (out.filter((g) => g.side === 'HOME').length !== homeScore || out.filter((g) => g.side === 'AWAY').length !== awayScore) return undefined;
  return out.sort((a, b) => a.minute - b.minute);
}
