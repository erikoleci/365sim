// Repeatable build of the local team-logo collection.
//
//   node scripts/build-team-logos.mjs [--logos <dir>] [--badges <dir>] [--height 72]
//
// Sources (both public GitHub repos; cloned to a temp dir when no local copy is given):
//   JoseArroyave/football-logos  SVG, ~4,700 clubs by country   (MIT)
//   leoratzlaff/football-badges  PNG 139x181, current top flights of 25 European countries
//
// Output (committed, served as static files):
//   public/team-logos/<country>/<slug>.webp      (fits a box of --height px, alpha kept)
//   public/team-logos/index.json   { v, files: { "<country>/<slug>.webp": 1 }, byKey: { "<teamKey>": ["<country>/<slug>.webp", ...] } }
//
// Every crest is rasterised once to a small WebP (about 3-6 KB instead of up to several MB of
// SVG with embedded bitmaps), which keeps the repo and every page load light. When the same club
// exists as SVG and as badge PNG the SVG wins (sharper at the same size).
// Needs `sharp` (devDependency). Re-run any time; the output folder is rebuilt from scratch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { teamKey } from '../utils/teamLogoKey.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'team-logos');

// football-logos country folder -> shown in the index. European coverage first.
const COUNTRIES = [
  'england', 'spain', 'italy', 'germany', 'france', 'portugal', 'netherlands', 'turkey', 'greece',
  'belgium', 'scotland', 'austria', 'switzerland', 'denmark', 'norway', 'sweden', 'poland',
  'czech-republic', 'croatia', 'serbia', 'ukraine', 'russia', 'romania', 'hungary', 'cyprus',
  'bulgaria', 'israel', 'albania', 'north-macedonia', 'kosovo', 'wales', 'northern-ireland',
  'republic-of-ireland', 'slovakia', 'slovenia', 'bosnia-and-herzegovina', 'finland', 'iceland',
  'kazakhstan', 'georgia', 'azerbaijan', 'luxembourg', 'montenegro', 'malta',
];
const BADGE_FOLDER_ALIAS = { turkiye: 'turkey' };

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
};
const HEIGHT = Number(arg('height', '72'));

function source(dirArg, repo) {
  if (dirArg) return dirArg;
  const dir = path.join(os.tmpdir(), repo.replace('/', '__'));
  if (!fs.existsSync(dir)) execFileSync('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, dir], { stdio: 'inherit' });
  return dir;
}
const LOGOS = source(arg('logos'), 'JoseArroyave/football-logos');
const BADGES = source(arg('badges'), 'leoratzlaff/football-badges');

const slug = (base) => base.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// candidates: country -> teamKey -> { src, ext, size }
const cand = new Map();
const put = (country, file, ext, size, src) => {
  const key = teamKey(path.basename(file, path.extname(file)).replace(/[_-]+/g, ' '));
  if (!key) return;
  const byKey = cand.get(country) ?? new Map();
  cand.set(country, byKey);
  const cur = byKey.get(key);
  // the SVG beats a PNG; between two files of one type keep the first (stable order)
  if (!cur || (cur.ext === 'png' && ext === 'svg')) byKey.set(key, { src, ext, size, base: path.basename(file, path.extname(file)) });
};

for (const country of COUNTRIES) {
  const dir = path.join(LOGOS, 'logos', country);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.svg')) continue;
    const full = path.join(dir, f);
    put(country, f, 'svg', fs.statSync(full).size, full);
  }
}
for (const folder of fs.existsSync(path.join(BADGES, 'logos')) ? fs.readdirSync(path.join(BADGES, 'logos')) : []) {
  const country = BADGE_FOLDER_ALIAS[folder] || folder;
  const dir = path.join(BADGES, 'logos', folder);
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.png')) continue;
    put(country, f, 'png', fs.statSync(path.join(dir, f)).size, path.join(dir, f));
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
let failed = 0;
const jobs = [];
for (const [country, teams] of [...cand].sort()) {
  fs.mkdirSync(path.join(OUT, country), { recursive: true });
  const used = new Set();
  for (const [key, c] of [...teams].sort()) {
    let name = slug(c.base) || 'club';
    while (used.has(name)) name += '-2';
    used.add(name);
    jobs.push({ key, c, rel: `${country}/${name}.webp` });
  }
}

async function convert({ c, rel }) {
  try {
    const buf = await sharp(c.src, { density: 288 })
      .resize({ width: HEIGHT, height: HEIGHT, fit: 'inside' })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    fs.writeFileSync(path.join(OUT, rel), buf);
    return buf.length;
  } catch {
    return 0; // an unreadable file is simply left out: that club gets the placeholder
  }
}

// A small worker pool: conversions are CPU bound and there are a few thousand of them.
const sizes = new Array(jobs.length).fill(0);
let next = 0;
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length) }, async () => {
  while (next < jobs.length) {
    const i = next++;
    sizes[i] = await convert(jobs[i]);
  }
}));

const files = {};
const byKey = {};
let bytes = 0;
jobs.forEach(({ key, rel }, i) => {
  if (!sizes[i]) { failed++; return; }
  files[rel] = 1;
  (byKey[key] ??= []).push(rel);
  bytes += sizes[i];
});
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: 1, files, byKey }));
fs.writeFileSync(path.join(OUT, 'SOURCES.md'), `# Team logos

Built by \`node scripts/build-team-logos.mjs\` from:

- https://github.com/JoseArroyave/football-logos (SVG, MIT License)
- https://github.com/leoratzlaff/football-badges (PNG, MIT per package.json)

The repository licences cover the collections. The crests themselves are trademarks of their
clubs and are shown only to identify the teams in the match list.
`);
console.log(`team logos: ${Object.keys(files).length} files, ${(bytes / 1048576).toFixed(1)} MB, ${Object.keys(byKey).length} keys, ${failed} unreadable and skipped`);
