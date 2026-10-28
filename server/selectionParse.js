// One tolerant reader for the option labels the feed (and the Odds API mapping) put on count / result
// markets, so the settlement rules never leave a ticket PENDING just because a label is written
// "+3" instead of "3+", "Barazim ose 2" instead of "X2", or "x/2" instead of "x-2".
//
// Every function returns null when the text really is not in the shape (never a guess), so the caller
// still falls back to PENDING for labels that genuinely mean something else.

export const normSel = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[–—−]/g, '-') // en / em dash / minus sign -> "-"
  .replace(/\s+/g, ' ')
  .trim();

// Unit words that may trail a count option: "3+ gola", "10+ korne", "2 cards".
const UNIT_TAIL = /\s*\b(gola|gol|goals?|korne|korner|korneve|karton|kartona|cards?|corners?|bookings?)\s*$/;

// "N" | "N+" | "+N" | ">=N" | "N e me shume" | "N or more"   -> [N, Infinity]
// "N-M"                                                       -> [N, M]
// "-N" | "N-" | "<=N" | "N e me pak" | "N or less"            -> [0, N]
// A bare "N" is an exact count [N, N].
// Returns [lo, hi] (inclusive) or null.
export function parseCountSelection(text) {
  let t = normSel(text).replace(UNIT_TAIL, '').trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d+)$/))) return [Number(m[1]), Number(m[1])];
  // open upper end: at least N
  if ((m = t.match(/^(?:>=|≥|\+)\s*(\d+)$/))) return [Number(m[1]), Infinity];
  if ((m = t.match(/^(\d+)\s*(?:\+|plus|(?:e|ose|dhe|or|and)\s+(?:me\s+shume|lart|mbi|more|over|above|up))$/))) return [Number(m[1]), Infinity];
  if (/^(?:me\s+shume\s+se|mbi|over|more\s+than)\s+\d+$/.test(t)) return null; // "Mbi 9" is a line (Over/Under), not a count option
  // range
  if ((m = t.match(/^(\d+)\s*(?:-|to|deri(?:\s+ne)?)\s*(\d+)$/))) {
    const lo = Number(m[1]); const hi = Number(m[2]);
    return lo <= hi ? [lo, hi] : null;
  }
  // open lower end: at most N
  if ((m = t.match(/^(?:<=|≤|-)\s*(\d+)$/))) return [0, Number(m[1])];
  if ((m = t.match(/^(\d+)\s*(?:-|(?:e|ose|dhe|or|and)\s+(?:me\s+pak|poshte|nen|less|fewer|under|below|down))$/))) return [0, Number(m[1])];
  if ((m = t.match(/^(?:deri\s+ne|max(?:imumi)?|up\s+to|at\s+most)\s+(\d+)$/))) return [0, Number(m[1])];
  return null;
}

export const inCountRange = (value, range) => !!range && Number.isFinite(value) && value >= range[0] && value <= range[1];

// ---- results: 1 / X / 2 -----------------------------------------------------------------------

const SIDE_WORDS = [
  [/\b(?:pritesi|pritesit|shtepiaku|shtepiak|vendasi|home|host)\b/g, ' 1 '],
  [/\b(?:udhetuesi|udhetuesit|mysafiri|mysafir|vizitori|vizitor|away|guest)\b/g, ' 2 '],
  [/\b(?:barazim|barazimi|baraz|draw|tie)\b/g, ' x '],
];
const FILLER = /\b(?:fiton|fitore|fitoi|wins?|to|per|ose|or|dhe|and|e)\b/g;

// Replaces the team names, side words and "barazim" by the tokens 1 / 2 / x and returns them in order.
function resultTokens(text, teams = {}) {
  let t = ` ${normSel(text).replace(/_/g, ' ')} `; // the Odds API id writes spaces as "_" (Alpha_FC_or_Draw)
  const names = [[normSel(teams.home), ' 1 '], [normSel(teams.away), ' 2 ']]
    .filter(([n]) => n.length > 0)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [n, token] of names) t = t.split(n).join(token);
  for (const [re, token] of SIDE_WORDS) t = t.replace(re, token);
  t = t.replace(FILLER, ' ');
  return t.split(/[^a-z0-9]+/).filter(Boolean);
}

// Double chance option -> '1X' | 'X2' | '12' | null.
// "X2", "x-2", "2X", "Barazim ose 2", "Alpha ose Barazim", "Alpha or Draw", "Fiton Udhetuesi ose Barazim",
// "Alpha_or_Beta" (the Odds API id) ...
export function parseDoubleChance(text, teams = {}) {
  const tokens = resultTokens(text, teams);
  const compact = { '1x': '1X', x1: '1X', x2: 'X2', '2x': 'X2', 12: '12', 21: '12' };
  if (tokens.length === 1) return compact[tokens[0]] || null;
  if (tokens.length === 2 && tokens.every((k) => /^[12x]$/.test(k)) && tokens[0] !== tokens[1]) return compact[tokens[0] + tokens[1]] || null;
  return null;
}

// Half-time / full-time option -> ['1'|'x'|'2', '1'|'x'|'2'] | null.   "x-2", "X/2", "1 / 1", "x 2", "x|2", "Barazim/2".
export function parseHalfFull(text, teams = {}) {
  const tokens = resultTokens(text, teams);
  if (tokens.length === 2 && tokens.every((k) => /^[12x]$/.test(k))) return [tokens[0], tokens[1]];
  if (tokens.length === 1 && /^[12x]{2}$/.test(tokens[0])) return [tokens[0][0], tokens[0][1]];
  return null;
}

// A single result option (1 / X / 2 or a team name / "Barazim") -> '1' | 'X' | '2' | null.
export function parseSingleResult(text, teams = {}) {
  const tokens = resultTokens(text, teams);
  return tokens.length === 1 && /^[12x]$/.test(tokens[0]) ? tokens[0].toUpperCase() : null;
}
