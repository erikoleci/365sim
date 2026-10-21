// One normalisation used by BOTH the asset indexer (scripts/build-team-logos.mjs) and the browser
// resolver (utils/teamLogos.ts), so a feed name and a file name meet on the same key.
//
// The key keeps everything that distinguishes two clubs (city, "united", "reserves", "u19", "ii",
// "women"...) and only drops legal-form noise that providers add or omit inconsistently
// ("FC", "CF", "AFC", "AC", "AS", "SC", "FK" ...). Nothing is fuzzy: no edit distance, no
// "contains" -- a wrong logo is worse than the neutral placeholder.
const NOISE = new Set(['fc', 'cf', 'afc', 'ac', 'as', 'sc', 'ss', 'fk', 'sk', 'sv', 'bk', 'if', 'cd', 'ud', 'sd', 'rc', 'rcd', 'ca', 'club', 'the', 'de', 'calcio', 'futbol', 'football', 'ssd', 'asd', 'ssc', 'us', 'og', 'gnk', 'nk', 'hnk', 'kv', 'ks', 'ksv', 'rsc', 'sporting-club', 'cfc']);

export function stripDiacritics(text) {
  return String(text ?? '')
    .replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/Ø/g, 'o').replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
    .replace(/œ/g, 'oe').replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/ł/g, 'l').replace(/Ł/g, 'l').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// "Manchester United FC" -> "manchester united"; "1. FC Köln" -> "1 koln"; "St. Pauli" -> "st pauli".
export function teamKey(name) {
  const tokens = stripDiacritics(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const kept = tokens.filter((t) => !NOISE.has(t));
  // A name made only of noise ("FC", "AS") keeps its tokens rather than becoming empty.
  return (kept.length ? kept : tokens).join(' ');
}
