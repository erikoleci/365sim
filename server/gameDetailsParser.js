// Parses the LondonPro365 "gamedetails" feed's single self-closing tag
// (e.g. `<Detaje EID="1" SC="1-2" .../>`) into a plain object of its
// attributes. No dependency needed — the feed is always one flat tag with
// no nesting and no text content, so a full XML parser would be pure
// overhead. Kept in its own file (zero imports) so it can be unit tested
// in isolation from the DB/socket wiring in london365GameDetails.js.
export function parseGameDetails(raw) {
  const tagMatch = /<\s*\w+([^>]*)\/?>/.exec(String(raw || ''));
  if (!tagMatch) return null;
  const attrs = {};
  const attrRe = /([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(tagMatch[1]))) attrs[m[1]] = m[2];
  if (!attrs.EID) return null;
  return attrs;
}
