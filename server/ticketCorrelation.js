// One match, one ticket: at most ONE selection about the RESULT, one about CORNERS and one about CARDS.
//
// Everything that is decided by the score of the match (1X2, double chance, draw no bet, handicap,
// half-time / full-time, correct score, total goals and goal counts, both teams to score, who scores,
// "Fiton Udhëtuesi ose Gol/JoGol", every combination like "Dopio Shans & Gol/JGol" ...) is the SAME
// logic: one outcome decides, overlaps or rules out the others, so the combined price is not the real
// price ("4+ goals" with "1+ / 2+ / 3+", "Draw / Yes" with "GG / GG" with "Jo" ...). They all count as
// "score": only one of them per match.
// Corners and cards are each their own group: one selection of each per match.
//   -> per match a ticket can hold: 1 result selection + 1 corners selection + 1 cards selection.
// The rule does not depend on the language of the market name: anything that is not about corners or
// cards is a score selection.
//
// "Same match" = same id OR same two teams starting within 24 h (the provider can list one real match
// under two ids).

import { classifyMarket } from './marketRules.js';
import { normMarketText as norm } from './marketPeriods.js';

const SAME_MATCH_WINDOW_MS = 24 * 3600 * 1000;

// -> Set of 'score' | 'corners' | 'cards'
export function selectionFamilies({ marketId, marketName, home, away }) {
  const c = classifyMarket(marketId, marketName, { home, away });
  const fam = new Set();
  if (c.kind === 'corners') fam.add('corners');
  else if (c.kind === 'cards') fam.add('cards');
  else fam.add('score');
  // a combination that mixes corners / cards with a result or goals part ("Rezultat & Korne") also
  // counts as a result selection
  if (fam.has('corners') || fam.has('cards')) {
    if (/&|\+|\bdhe\b|\band\b/.test(norm(marketName)) && /rezultat|1x2|dopio|gol|goal|total|fiton|win/.test(norm(marketName))) fam.add('score');
  }
  return fam;
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
// -> { first, second, family } for the first pair that shares a group in one match, or null.
export function findCorrelatedSelections(selections) {
  const gids = groupIds(selections);
  const seen = new Map(); // `${match}::${family}` -> selection
  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    for (const family of selectionFamilies(sel)) {
      const key = `${gids[i]}::${family}`;
      const prev = seen.get(key);
      if (prev) return { first: prev, second: sel, family };
      seen.set(key, sel);
    }
  }
  return null;
}
