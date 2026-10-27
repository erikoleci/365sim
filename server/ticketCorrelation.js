// Same-match selections that follow the SAME logic cannot sit on one ticket: one outcome decides
// (or overlaps) the other, so the combined price is not the real price.
//   * "4+ goals" with "1+", "2+", "3+" goals: if 4+ wins, all of them win;
//   * "1 & 2+ goals" with "0-3 goals": the two overlap;
//   * "1" with "1X" (double chance), "Over 1.5" with "Over 2.5", Over + a goal range, ...
// Every selection is mapped to the "logic families" it depends on (goals, result, corners,
// cards); two selections of the same match that share a family are refused.
// BTTS (both teams to score) is a family of its own and may be combined with the others.

import { classifyMarket } from './marketRules.js';
import { normMarketText as norm } from './marketPeriods.js';

const RESULT_WORDS = /rezultat|1x2|dopio|shans|fitues|fiton|\b1\b|\b2\b/;
const GOAL_WORDS = /gol|total|numri|mbi|nen|over|under|lart|poshte/;
const GOAL_COUNT_OPTION = /^\d+\s*\+$|^\d+\s*-\s*\d+$|^(mbi|nen|over|under|lart|poshte)[\s-]*\d/;

// -> Set of 'goals' | 'result' | 'corners' | 'cards' | 'btts'
export function selectionFamilies({ marketId, marketName, optionName, home, away }) {
  const c = classifyMarket(marketId, marketName, { home, away });
  const name = norm(marketName);
  const fam = new Set();
  switch (c.kind) {
    case 'totals': case 'team_totals': case 'odd_even': fam.add('goals'); break;
    case 'result': case 'double_chance': case 'dnb': case 'handicap': case 'htft': fam.add('result'); break;
    case 'correct_score': fam.add('result'); fam.add('goals'); break;
    case 'corners': fam.add('corners'); break;
    case 'cards': fam.add('cards'); break;
    case 'btts': fam.add('btts'); break;
    case 'combo': {
      const r = RESULT_WORDS.test(name);
      const g = GOAL_WORDS.test(name);
      // unknown combination: assume it touches both (strict side)
      if (r || !g) fam.add('result');
      if (g || !r) fam.add('goals');
      break;
    }
    default:
      // markets we cannot classify by name but whose options are goal counts (1+, 2+, 0-3 ...)
      if (/gol/.test(name) && GOAL_COUNT_OPTION.test(norm(optionName))) fam.add('goals');
  }
  return fam;
}

// selections: [{ matchId, marketId, marketName, optionName, home, away }]
// -> { first, second, family } for the first correlated pair, or null.
export function findCorrelatedSelections(selections) {
  const seen = new Map(); // `${matchId}::${family}` -> selection
  for (const sel of selections) {
    for (const family of selectionFamilies(sel)) {
      const key = `${sel.matchId}::${family}`;
      const prev = seen.get(key);
      if (prev) return { first: prev, second: sel, family };
      seen.set(key, sel);
    }
  }
  return null;
}
