// Shared rules for deciding that two provider records are the SAME fixture (pre-match catalogue vs in-play).
// Kept free of imports from settlement/liveTwin so both can use it.

const GENERIC_CLUB_WORDS = new Set(['fc', 'cf', 'ca', 'rc', 'sc', 'ac', 'as', 'cd', 'sd', 'ud', 'afc', 'sk', 'fk', 'stade', 'de', 'la', 'le', 'el', 'a', 'da', 'do', 'of', 'club', 'calcio', 'ad', 'deportivo', 'deportes']);
function clubKeyWords(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !GENERIC_CLUB_WORDS.has(t));
}
export function looseSameClub(a, b) {
  const ka = clubKeyWords(a), kb = clubKeyWords(b);
  if (!ka.length || !kb.length) return false;
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return s.every((t) => l.some((u) => u === t || (t.length >= 4 && u.length >= 4 && (u.startsWith(t) || t.startsWith(u)))));
}

// Strongest link between the two records of one fixture: SAME league key, kick-off within 2 minutes, and at least one
// club that matches. The provider writes the other club differently ("Reserves" / "II"), but league + minute never
// differ for the same fixture, so this does not depend on how the names are spelled.
export const LINK_START_TOLERANCE_MS = 2 * 60000;
export function strictSameFixture(a, b) {
  if (!a || !b || !a.league || a.league !== b.league) return false;
  const ta = Date.parse(a.start_time), tb = Date.parse(b.start_time);
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || Math.abs(ta - tb) > LINK_START_TOLERANCE_MS) return false;
  return looseSameClub(a.home_team, b.home_team) || looseSameClub(a.away_team, b.away_team)
    || looseSameClub(a.home_team, b.away_team) || looseSameClub(a.away_team, b.home_team);
}

