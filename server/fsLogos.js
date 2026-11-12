// Team crests from Flashscore. NOTHING is downloaded or stored as a file: only the picture's address is kept (one small row per team),
// and the visitor's browser loads the picture itself. The key is OUR team name (the one on our coupon), found through the same
// match that already links our row to the Flashscore fixture, so spelling differences between the two sites do not matter.
import { teamKey } from '../utils/teamLogoKey.js';

const OK_URL = /^https:\/\/[a-z0-9.-]*flashscore\.com\/[\w\-./%]+\.(png|jpe?g|webp|svg)$/i;
export const validLogoUrl = (u) => typeof u === 'string' && u.length < 300 && OK_URL.test(u);

const known = new Map(); // team key -> url already written by this process (so a cycle writes only what is new)
export function __resetFsLogosForTests() { known.clear(); mapCache = null; }

// pairs: [{ home, away, homeLogo, awayLogo }] with OUR names. Returns how many rows were written.
export async function harvestLogos(pool, pairs) {
  const fresh = new Map();
  const add = (name, url) => {
    if (!name || !validLogoUrl(url)) return;
    const k = teamKey(name);
    if (!k || known.get(k) === url) return;
    fresh.set(k, url);
  };
  for (const p of pairs || []) { add(p.home, p.homeLogo); add(p.away, p.awayLogo); }
  if (!fresh.size) return 0;
  const keys = [...fresh.keys()]; const urls = keys.map((k) => fresh.get(k));
  try {
    await pool.query(
      `INSERT INTO fs_team_logos (team_key, url, updated_at)
       SELECT k, u, $3 FROM unnest($1::text[], $2::text[]) AS t(k, u)
       ON CONFLICT (team_key) DO UPDATE SET url = EXCLUDED.url, updated_at = EXCLUDED.updated_at`,
      [keys, urls, Date.now()]
    );
    keys.forEach((k, i) => known.set(k, urls[i]));
    mapCache = null;
    return keys.length;
  } catch (e) {
    console.warn('[fs-logos] write failed: ' + (e && e.message));
    return 0;
  }
}

let mapCache = null;
const MAP_TTL_MS = 5 * 60000;
// { team key: url } for the browser; cached in memory for 5 minutes, so the page never costs a query per visitor.
export async function getFsLogoMap(pool, now = Date.now()) {
  if (mapCache && now - mapCache.at < MAP_TTL_MS) return mapCache.body;
  const { rows } = await pool.query('SELECT team_key, url FROM fs_team_logos');
  const logos = {};
  for (const r of rows) if (validLogoUrl(r.url)) logos[r.team_key] = r.url;
  mapCache = { at: now, body: { v: 1, logos } };
  return mapCache.body;
}
