// Looks the provider's own site up for the text it shows for each live action code ("Goditje dënimi",
// "Penallti", ...): downloads the site's page and the scripts it links (same site only, size capped) and
// returns the places where those words occur, plus any "code: label" pairs found next to them.
// Read-only and on demand (admin endpoint); nothing is stored. Used to find the VC code of a penalty.
import { SITE_ORIGIN, API_BASE } from './london365/config.js';
import { HEADERS } from './london365/api.js';

const WORDS = /penal|goditje\s*d[eë]nimi|rivenie\s*fundore|riv[eë]nie\s*fundore|gjuajtje\s*e\s*lir[eë]|goditje\s*n[eë]\s*port[eë]/gi;
const MAX_SCRIPTS = 25;
const MAX_BYTES = 3_000_000;

async function get(url) {
  const r = await fetch(url, { headers: { ...HEADERS, Accept: '*/*' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.text()).slice(0, MAX_BYTES);
}

export function extractMatches(text, source) {
  const out = [];
  let m;
  WORDS.lastIndex = 0;
  while ((m = WORDS.exec(text)) && out.length < 60) {
    const from = Math.max(0, m.index - 160);
    const around = text.slice(from, m.index + m[0].length + 160).replace(/\s+/g, ' ');
    // "1010":"Goditje dënimi" / 1010:'...' / {code:1010,label:'...'} style pairs inside the window
    const pairs = [...around.matchAll(/["']?(\d{3,5})["']?\s*[:=,]\s*["']([^"']{3,60})["']/g)].map((p) => ({ code: p[1], text: p[2] }));
    out.push({ source, word: m[0], around, pairs });
  }
  return out;
}

export async function findProviderLabels() {
  const origins = [...new Set([SITE_ORIGIN, API_BASE])];
  const result = { checked: [], matches: [], errors: [] };
  for (const origin of origins) {
    let html;
    try { html = await get(origin + '/'); } catch (e) { result.errors.push(`${origin}/ ${e.message}`); continue; }
    result.checked.push(origin + '/');
    result.matches.push(...extractMatches(html, origin + '/'));
    const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], origin + '/').href)
      .filter((u) => new URL(u).origin === new URL(origin).origin).slice(0, MAX_SCRIPTS);
    for (const u of srcs) {
      try {
        const js = await get(u);
        result.checked.push(u);
        result.matches.push(...extractMatches(js, u));
      } catch (e) { result.errors.push(`${u} ${e.message}`); }
    }
  }
  result.matches = result.matches.slice(0, 80);
  return result;
}
