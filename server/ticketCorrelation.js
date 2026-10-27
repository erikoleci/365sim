// Same-match selections that follow the SAME logic cannot sit on one ticket: one outcome decides
// (or overlaps, or rules out) the other, so the combined price is not the real price.
//   * "4+ goals" with "1+", "2+", "3+" goals: if 4+ wins, all of them win;
//   * "1 & 2+ goals" with "0-3 goals": the two overlap;
//   * "1" with "1X" (double chance), "Over 1.5" with "Over 2.5", Over + a goal range, ...
//   * both teams to score "Yes" with Over 0.5 / 1.5 (it needs 2+ goals), BTTS "No" with Under 1.5;
//   * "1" with "1 qualifies", first scorer with "team scores" / BTTS.
// Every selection is mapped to the "logic families" it depends on (goals, result, scoring,
// corners, cards, btts); two selections of the same match that share a family are refused.
// BTTS also has its own exact check against the goal-count selections (see bttsConflict).
// "Same match" = same id OR same two teams starting within 24 h (the provider can list one
// real match under two ids).

import { classifyMarket, nextEventKind, eventOrderOrdinal } from './marketRules.js';
import { parseProviderMarket } from './providerMarkets.js';
import { normMarketText as norm } from './marketPeriods.js';

const RESULT_WORDS = /rezultat|1x2|dopio|shans|fitues|fiton|\b1\b|\b2\b/;
const GOAL_WORDS = /gol|total|numri|mbi|nen|over|under|lart|poshte/;
const GOAL_COUNT_OPTION = /^\d+\s*\+(\s*gol[a]?)?$|^\d+\s*gol[a]?$|^\d+\s*-\s*\d+$|^(mbi|nen|over|under|lart|poshte)[\s-]*\d/;
// who scores / in which order / clean sheets: all about the same scoring facts
const SCORING_WORDS = /shenon|shenojne|pa pesuar|clean sheet|goli i (pare|fundit|dyte)|gola i (pare|fundit|dyte)/;
const QUALIFY_WORDS = /kualifik|kalon ne|fiton ne|avancon|promovon/;
const ASIAN_WORDS = /aziatik|asian/;
const SAME_MATCH_WINDOW_MS = 24 * 3600 * 1000;

// -> Set of 'goals' | 'result' | 'scoring' | 'corners' | 'cards' | 'btts'
export function selectionFamilies({ marketId, marketName, optionName, home, away }) {
  const c = classifyMarket(marketId, marketName, { home, away });
  const name = norm(marketName);
  const fam = new Set();
  // The provider's own markets (Nr-Gola, Rezultat Final/Gol-Gol, RF-60Min, "Goli ... perpara min. N", ...):
  // each one is about the same goals / result / scoring facts as the standard markets.
  const spec = parseProviderMarket(name);
  if (spec) {
    switch (spec.type) {
      case 'team_goals': fam.add('goals'); fam.add('scoring'); break;        // a team's goal count
      case 'team_scores': fam.add('scoring'); break;                         // a team scores in a half
      case 'btts_half': fam.add('btts'); fam.add('scoring'); break;
      case 'result_btts': fam.add('result'); fam.add('btts'); fam.add('scoring'); break;
      case 'goal_before': fam.add('goals'); fam.add('scoring'); break;       // the k-th goal before minute N
      case 'rf_at': fam.add('result'); break;                                // the result at minute N
      case 'result_goals': fam.add('result'); fam.add('goals'); break;       // result & goals N+
    }
  }
  // next goal / corner / card, and the provider's first / second goal, first / last corner, first card
  const ev = nextEventKind(marketName) || (eventOrderOrdinal(marketName) || {}).kind;
  if (ev === 'goal') fam.add('scoring');
  else if (ev === 'corner') fam.add('corners');
  else if (ev === 'card') fam.add('cards');
  switch (c.kind) {
    case 'totals': case 'team_totals': case 'odd_even': fam.add('goals'); break;
    case 'result': case 'double_chance': case 'dnb': case 'handicap': case 'htft': fam.add('result'); break;
    case 'correct_score': fam.add('result'); fam.add('goals'); break;
    case 'corners': fam.add('corners'); break;
    case 'cards': fam.add('cards'); break;
    case 'btts': fam.add('btts'); fam.add('scoring'); break; // both teams scoring is a scoring fact
    case 'first_scorer': fam.add('scoring'); break;
    case 'combo': {
      const r = RESULT_WORDS.test(name);
      const g = GOAL_WORDS.test(name);
      // unknown combination: assume it touches both (strict side)
      if (r || !g) fam.add('result');
      if (g || !r) fam.add('goals');
      break;
    }
    default:
      // markets we cannot classify by kind: judge them by their name / options
      if (SCORING_WORDS.test(name)) fam.add('scoring');
      else if (QUALIFY_WORDS.test(name)) fam.add('result'); // "1" win => "1 qualifies"
      else if (/handikap|handicap/.test(name)) fam.add('result');
      else if (ASIAN_WORDS.test(name) && /gol/.test(name)) fam.add('goals');
      else if (/gol/.test(name) && GOAL_COUNT_OPTION.test(norm(optionName))) fam.add('goals');
  }
  return fam;
}

// Set of total-goals values a goal-count option covers: { min, max } (max may be Infinity), or null.
export function goalInterval(optionName) {
  const o = norm(optionName);
  let m = o.match(/^(mbi|over|lart)[\s-]*([0-9]+(?:[.,][0-9]+)?)$/);
  if (m) { const x = parseFloat(m[2].replace(',', '.')); return { min: (Number.isInteger(x) ? x : Math.floor(x)) + 1, max: Infinity }; }
  m = o.match(/^(nen|under|poshte)[\s-]*([0-9]+(?:[.,][0-9]+)?)$/);
  if (m) { const x = parseFloat(m[2].replace(',', '.')); return { min: 0, max: Number.isInteger(x) ? x - 1 : Math.floor(x) }; }
  m = o.match(/^(\d+)\s*\+$/);
  if (m) return { min: Number(m[1]), max: Infinity };
  m = o.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = o.match(/^(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

const bttsSide = (optionName) => {
  const o = norm(optionName).replace(/\s+/g, '');
  if (/^(jogol|jo|no|nuk|nogoal)$/.test(o)) return 'no';
  if (/^(gol|po|yes|ja|goal)$/.test(o)) return 'yes';
  return null;
};

// BTTS "Yes" needs 2+ goals: a goal selection that covers every total from 2 up is won by it
// (Over 0.5 / 1.5, 1+, 2+), one that allows at most 1 goal can never come together with it.
// BTTS "No" is implied by every selection that allows at most 1 goal (Under 0.5 / 1.5, 0-1).
// The goal selection's period must be the BTTS period or the whole match.
function bttsConflict(btts, goals) {
  if (btts.period && goals.period && btts.period !== goals.period) return false;
  if (!btts.period && goals.period) return false;
  const iv = goals.interval;
  if (btts.side === 'yes') return (iv.max === Infinity && iv.min <= 2) || iv.max <= 1;
  return iv.max <= 1;
}

function groupIds(selections) {
  const groups = []; // { key, t }
  const byId = new Map();
  return selections.map((sel) => {
    if (byId.has(sel.matchId)) return byId.get(sel.matchId);
    let gid = -1;
    if (sel.home && sel.away) {
      const key = norm(sel.home) + '|' + norm(sel.away);
      const t = Date.parse(sel.startTime);
      gid = groups.findIndex((g) => g.key === key && (Number.isNaN(t) || Number.isNaN(g.t) || Math.abs(g.t - t) < SAME_MATCH_WINDOW_MS));
      if (gid < 0) { groups.push({ key, t }); gid = groups.length - 1; }
    } else {
      groups.push({ key: 'id:' + sel.matchId, t: NaN }); gid = groups.length - 1;
    }
    byId.set(sel.matchId, gid);
    return gid;
  });
}

// selections: [{ matchId, marketId, marketName, optionName, home, away, startTime }]
// -> { first, second, family } for the first correlated pair, or null.
export function findCorrelatedSelections(selections) {
  const gids = groupIds(selections);
  const seen = new Map(); // `${group}::${family}` -> selection
  const btts = []; const goalsSel = []; // for the exact BTTS check
  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    const g = gids[i];
    for (const family of selectionFamilies(sel)) {
      const key = `${g}::${family}`;
      const prev = seen.get(key);
      if (prev) return { first: prev, second: sel, family };
      seen.set(key, sel);
    }
    const c = classifyMarket(sel.marketId, sel.marketName, { home: sel.home, away: sel.away });
    if (c.kind === 'btts') {
      const side = bttsSide(sel.optionName);
      if (side) btts.push({ g, sel, side, period: c.period || null });
    } else if (c.kind === 'totals') {
      const interval = goalInterval(sel.optionName);
      if (interval) goalsSel.push({ g, sel, interval, period: c.period || null });
    }
  }
  for (const b of btts) {
    for (const t of goalsSel) {
      if (b.g === t.g && bttsConflict(b, t)) return { first: b.sel, second: t.sel, family: 'btts' };
    }
  }
  return null;
}
