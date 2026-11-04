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
import { sameFixture, sameTeam } from './fixtureDedupe.js';

const SAME_MATCH_WINDOW_MS = 24 * 3600 * 1000;
const SAME_KICKOFF_WINDOW_MS = 3 * 3600 * 1000;

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
  const groups = []; // { home, away, t }
  const byId = new Map();
  return selections.map((sel) => {
    if (byId.has(sel.matchId)) return byId.get(sel.matchId);
    let gid = -1;
    if (sel.home && sel.away) {
      const t = Date.parse(sel.startTime);
      // The same real match can come under two provider records with different spellings
      // ("Feyenoord v Inter Milan" / "Feyenoord Rotterdam v Inter Milano", "Barcelona" / "FC Barcelona"):
      // compared like the fixture de-duplication does, not by exact text, or the one-result rule is bypassed.
      // Names that differ by more than a spelling ("PSG" / "Paris Saint-Germain", "Man Utd" / "Manchester United") are
      // still one match when ONE side is the same team and the kick-offs are within a few hours: a team never plays two
      // matches in that window.
      gid = groups.findIndex((g) => {
        if (!g.home) return false;
        const timesKnown = !Number.isNaN(t) && !Number.isNaN(g.t);
        if (timesKnown && Math.abs(g.t - t) >= SAME_MATCH_WINDOW_MS) return false;
        if (sameFixture({ homeTeam: g.home, awayTeam: g.away }, { homeTeam: sel.home, awayTeam: sel.away })) return true;
        if (!timesKnown || Math.abs(g.t - t) > SAME_KICKOFF_WINDOW_MS) return false;
        return sameTeam(g.home, sel.home) || sameTeam(g.away, sel.away) || sameTeam(g.home, sel.away) || sameTeam(g.away, sel.home);
      });
      if (gid < 0) { groups.push({ home: sel.home, away: sel.away, t }); gid = groups.length - 1; }
    } else {
      groups.push({ home: null, away: null, t: NaN }); gid = groups.length - 1;
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
