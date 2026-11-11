// Mathematical profile of every casino game. Each game has its OWN profile; the super admin edits them in the panel
// (stored in kv_store, every change goes to the audit log), nothing here needs a code change.
//
// How a result is made (server side, before anything is shown, never depending on who plays or on their history):
//   kind 'outcome'  one independent draw decides win / no win with probability hitFrequency, then a real round of the game
//                   with that result is drawn (a losing round pays nothing, a winning round pays something). Winning
//                   payouts are multiplied by one fixed factor so the long-run return equals `rtp`:
//                   scale = rtp / (hitFrequency * meanWin), where meanWin is the game's measured mean win
//                   (server/casinoCalibration.json, produced by scripts/calibrateCasino.mjs).
//   kind 'rtp'      the chances are fixed by the rules (a race, a plinko board); only the payout table is scaled to `rtp`.
//   kind 'bets'     the payouts are fixed by the rules of the game (roulette, blackjack...), only the bet limits are set.
import fs from 'node:fs';
import pool from './db.js';
import { CASINO_GAME_KEYS } from './casinoAccess.js';
import { SLOT_GAMES } from './slots/games.js';
import { CRASH_RTP } from './crash.js';
import { HILO_RTP } from './hilo.js';
import { KENO_RTP } from './keno.js';
import { CHAIN_RTP } from './chain.js';
import { MINES_RTP } from './casinoMath.js';

const KEY = 'casino_profiles';
const CAL_PATH = new URL('./casinoCalibration.json', import.meta.url);
let calibration = {};
try { calibration = JSON.parse(fs.readFileSync(CAL_PATH, 'utf8')); } catch { calibration = {}; }
export const getCalibration = (key) => calibration[key] || null;

const OUTCOME_DEFAULTS = { hitFrequency: 0.15, rtp: 0.3, volatility: 5, minBet: 1, maxBet: 5000, maxWinMultiplier: 2000 };
const RTP_DEFAULTS = { rtp: 0.6, minBet: 1, maxBet: 5000 };
// Fixed-chance games whose payout table is scaled to the RTP. The default is the game's own RTP, so nothing changes until the admin does.
export const NATURAL_RTP = { dice: 0.95, cups: 0.95 };
const BETS_DEFAULTS = { minBet: 1, maxBet: 5000 };

const OUTCOME_KEYS = ['slots', 'tumble', 'wheel', 'scratch', 'holdwin'];
const RTP_KEYS = ['dogs', 'horses', 'plinko', 'dice', 'cups'];
export const slotKey = (id) => `slot:${id}`;

const LABELS = {
  slots: 'Super Slots', tumble: 'Sugar Cascade', wheel: 'Wheel of Fortune', scratch: 'Scratch & Win', holdwin: 'Hold & Win',
  dogs: 'Dog Race', horses: 'Horse Race', plinko: 'Plinko', roulette: 'Roulette', baccarat: 'Baccarat', blackjack: 'Blackjack Pro',
  videopoker: 'Video Poker', dice: 'Dice', mines: 'Mines', dragontiger: 'Dragon Tiger', keno: 'Keno', crash: 'Crash', hilo: 'Hi-Lo',
  penalty: 'Penalty Shootout', tower: 'Gold Tower', cups: 'Three Cups', liveroulette: 'Live Roulette', livehorses: 'Live Horse Race',
  livedogs: 'Live Dog Race', livecrash: 'Live Crash', livekeno: 'Live Keno',
};

// What the rules of a game fix (shown read-only in the Admin Panel, next to the settings that CAN be changed).
// Numbers come from the game's own constants; "return" is the long-run return of the rules.
const pc = (x) => `${(x * 100).toFixed(1)}%`;
const RULES = {
  roulette: 'Single-zero wheel (37 pockets 0-36). A number pays 35:1, red/black/even/odd pay 1:1. Natural return 97.3%. Chances and payouts are fixed by the rules.',
  baccarat: 'Standard baccarat drawing rules. Player pays 1:1, Banker 0.95:1, Tie 8:1. Chances and payouts are fixed by the rules.',
  blackjack: 'Standard blackjack rules, blackjack pays 3:2. Chances and payouts are fixed by the rules.',
  videopoker: 'Standard 5-card draw with a fixed pay table. Chances and payouts are fixed by the rules.',
  mines: `5x5 board, the payout grows with every safe reveal at ${pc(MINES_RTP)} of the fair multiplier. Fixed by the rules.`,
  tower: `Each safe step pays ${pc(CHAIN_RTP)} of the fair multiplier, up to 10 steps. Fixed by the rules.`,
  penalty: `Each goal pays ${pc(CHAIN_RTP)} of the fair multiplier, up to 10 kicks. Fixed by the rules.`,
  hilo: `Each correct guess pays ${pc(HILO_RTP)} of the fair multiplier. Fixed by the rules.`,
  crash: `The crash point is drawn so that P(crash >= x) = ${pc(CRASH_RTP)} / x. Fixed by the rules.`,
  keno: `Pick 1-8 of 40, 10 drawn. Pay table from hypergeometric odds at ${pc(KENO_RTP)} return, max 1000x. Fixed by the rules.`,
  dragontiger: 'One card each, higher wins. Dragon/Tiger pay 1:1 (half back on a tie), Tie pays 15:1. Chances and payouts are fixed by the rules.',
  liveroulette: 'Same rules as Roulette, shared table every spin. Fixed by the rules.',
  livehorses: 'Same horses as Horse Race, new chances and odds every race at 95% return. Fixed by the rules.',
  livedogs: 'Same dogs as Dog Race, new chances and odds every race at 95% return. Fixed by the rules.',
  livecrash: 'Same crash curve as Crash, one shared round every 40 s. Fixed by the rules.',
  livekeno: 'Same pay table as Keno, one shared draw per round. Fixed by the rules.',
  dogs: 'Six dogs; chances change every race, the odds are 1/chance times the RTP. Only the RTP and bet limits can be set.',
  horses: 'Six horses; chances change every race, the odds are 1/chance times the RTP. Only the RTP and bet limits can be set.',
  plinko: 'Binomial ball path (fair), payout table per risk level scaled to the RTP. Only the RTP and bet limits can be set.',
  dice: 'Two dice: under 7 / over 7 / exactly 7. Chances are fixed; payouts are scaled to the RTP. Only the RTP and bet limits can be set.',
  cups: 'One ball under three cups (1 in 3). The payout is scaled to the RTP. Only the RTP and bet limits can be set.',
};
export const rulesOf = (key) => RULES[key] || null;

function buildRegistry() {
  const reg = {};
  for (const k of OUTCOME_KEYS) reg[k] = { key: k, label: LABELS[k], kind: 'outcome', defaults: OUTCOME_DEFAULTS };
  for (const g of SLOT_GAMES) reg[slotKey(g.id)] = { key: slotKey(g.id), label: g.name, kind: 'outcome', group: 'Video slots', defaults: OUTCOME_DEFAULTS };
  for (const k of RTP_KEYS) reg[k] = { key: k, label: LABELS[k], kind: 'rtp', defaults: NATURAL_RTP[k] ? { ...RTP_DEFAULTS, rtp: NATURAL_RTP[k] } : RTP_DEFAULTS };
  for (const k of CASINO_GAME_KEYS) if (!reg[k]) reg[k] = { key: k, label: LABELS[k] || k, kind: 'bets', defaults: BETS_DEFAULTS };
  return reg;
}
export const REGISTRY = buildRegistry();
export const PROFILE_KEYS = Object.keys(REGISTRY);

// ---- validation -----------------------------------------------------------------------------------------------
const RANGES = {
  hitFrequency: [0.01, 0.95], rtp: [0.05, 1], volatility: [1, 5], minBet: [1, 5000], maxBet: [1, 5000], maxWinMultiplier: [1, 100000],
};
export const FIELD_LABELS = { hitFrequency: 'Hit frequency', rtp: 'RTP', volatility: 'Volatility', minBet: 'Min bet', maxBet: 'Max bet', maxWinMultiplier: 'Max win (x stake)' };

/** Returns the cleaned fields or throws an Error with a message for the panel. Unknown fields are refused. */
export function cleanProfileInput(key, input) {
  const entry = REGISTRY[key];
  if (!entry) throw new Error('Unknown game');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings');
  const out = {};
  for (const [field, value] of Object.entries(input)) {
    if (!(field in entry.defaults)) throw new Error(`${field} is not a setting of ${entry.label}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${FIELD_LABELS[field] || field} must be a number`);
    const [lo, hi] = RANGES[field];
    if (value < lo || value > hi) throw new Error(`${FIELD_LABELS[field] || field} must be between ${lo} and ${hi}`);
    out[field] = value;
  }
  return out;
}
function checkWhole(key, p) {
  if (p.hitFrequency !== undefined && p.hitFrequency * p.maxWinMultiplier < p.rtp) throw new Error('Max win is too low for this hit frequency and RTP');
  if (p.hitFrequency !== undefined && p.rtp / p.hitFrequency < 0.1) throw new Error('RTP / hit frequency must be at least 0.1 (an average win below 0.1x the stake would round to nothing)');
  if (p.minBet !== undefined && p.maxBet !== undefined && p.minBet > p.maxBet) throw new Error('Min bet cannot be above max bet');
}

// ---- storage (kv_store, small cache) ---------------------------------------------------------------------------
let cache = null; let cacheAt = 0;
const TTL_MS = 15000;
async function readOverrides() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [KEY]);
    cache = rows[0] ? JSON.parse(rows[0].value) : {};
  } catch { cache = cache || {}; }
  cacheAt = Date.now();
  return cache;
}
export const clearProfileCache = () => { cache = null; };

const merge = (entry, overrides) => {
  const o = overrides?.[entry.key] || {};
  const out = { ...entry.defaults };
  for (const f of Object.keys(entry.defaults)) if (typeof o[f] === 'number' && Number.isFinite(o[f])) out[f] = o[f];
  return out;
};
export async function getProfile(key) {
  const entry = REGISTRY[key];
  if (!entry) return null;
  return { ...merge(entry, await readOverrides()), key, kind: entry.kind };
}
const slim = (c) => (c ? { rounds: c.rounds, pWin: c.pWin, meanWin: c.meanWin, rtpNat: c.rtpNat, sd: c.sd, max: c.max, method: c.method } : null);
export async function getAllProfiles() {
  const ov = await readOverrides();
  return PROFILE_KEYS.map((k) => {
    const e = REGISTRY[k];
    return { key: k, label: e.label, kind: e.kind, group: e.group || null, defaults: e.defaults, values: merge(e, ov), calibration: slim(getCalibration(k)), customised: !!ov[k], rules: RULES[k] || null,
      preview: e.kind === 'outcome' ? previewOutcome(merge(e, ov), getCalibration(k)) : null };
  });
}
/** Saves the changed fields of one game. Returns { before, after } for the audit log. */
export async function saveProfile(key, input) {
  const entry = REGISTRY[key];
  if (!entry) throw new Error('Unknown game');
  const cleaned = cleanProfileInput(key, input);
  const ov = { ...(await readOverrides()) };
  const before = merge(entry, ov);
  const after = { ...before, ...cleaned };
  checkWhole(key, after);
  ov[key] = after;
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [KEY, JSON.stringify(ov)]);
  cache = ov; cacheAt = Date.now();
  return { before, after };
}
export async function resetProfile(key) {
  const entry = REGISTRY[key];
  if (!entry) throw new Error('Unknown game');
  const ov = { ...(await readOverrides()) };
  const before = merge(entry, ov);
  delete ov[key];
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [KEY, JSON.stringify(ov)]);
  cache = ov; cacheAt = Date.now();
  return { before, after: merge(entry, ov) };
}

// ---- the maths ------------------------------------------------------------------------------------------------
// A game's natural winning payouts are kept as a histogram (cal.dist = [[payout, rounds], ...]). Volatility reshapes WHICH winning
// rounds happen (the paytable itself is never touched); the payout factor then brings the return back to the configured RTP:
//   volatility 5   the game's own shape (with hit frequency and RTP fixed this is already the spikiest shape the game can have:
//                  its big wins are rare but huge; pushing more weight to the big wins only lowers the spread).
//   volatility < 5 flatter: a winning round with natural payout m is kept with probability min(1, (m / median)^-alpha),
//                  alpha = (5 - volatility) / 2, so big wins become rarer and the common wins pay more.
// The factor `scale` solves  hit * E[min(scale * m, maxWin)] = rtp  exactly.
const alphaOf = (volatility) => Math.max(0, (5 - volatility) / 2);
const accept = (m, alpha, m0) => (alpha === 0 ? 1 : Math.min(1, (m / m0) ** -alpha));
const models = new WeakMap();
function model(cal, profile) {
  const key = `${profile.hitFrequency}|${profile.rtp}|${profile.volatility}|${profile.maxWinMultiplier}`;
  let byKey = models.get(cal);
  if (!byKey) { byKey = new Map(); models.set(cal, byKey); }
  const hit = byKey.get(key);
  if (hit) return hit;
  const dist = cal.dist;
  const total = dist.reduce((a, [, c]) => a + c, 0);
  let cum = 0; let m0 = dist[dist.length - 1][0];
  for (const [m, c] of dist) { cum += c; if (cum >= total / 2) { m0 = m; break; } }
  const alpha = alphaOf(profile.volatility ?? 5);
  const w = dist.map(([m, c]) => c * accept(m, alpha, m0));
  const wSum = w.reduce((a, b2) => a + b2, 0);
  const q = w.map((x) => x / wSum);
  const cap = profile.maxWinMultiplier;
  const target = profile.rtp / profile.hitFrequency; // mean payout of a winning round, in stakes
  const meanPay = (sc) => dist.reduce((a, [m], i) => a + q[i] * Math.min(sc * m, cap), 0);
  let scale; let capped = false;
  if (target >= cap) { scale = cap / dist[0][0]; capped = true; } else {
    let lo = 0; let hi = cap / dist[0][0];
    for (let i = 0; i < 80; i += 1) { const mid = (lo + hi) / 2; if (meanPay(mid) < target) lo = mid; else hi = mid; }
    scale = (lo + hi) / 2;
  }
  const out = { scale, alpha, m0, q, dist, capped };
  if (byKey.size > 200) byKey.clear();
  byKey.set(key, out);
  return out;
}

/** Payout factor for an 'outcome' game: long-run return = rtp (with the max win cap taken into account). */
export function outcomeScale(profile, cal) {
  if (!cal || !(cal.meanWin > 0)) return 1;
  if (!cal.dist?.length) return profile.rtp / (profile.hitFrequency * cal.meanWin);
  return model(cal, profile).scale;
}

/** What the profile will do, computed from the measured payout histogram (nothing is played). Shown in the Admin Panel. */
export function previewOutcome(profile, cal) {
  if (!cal?.dist?.length) return null;
  const mdl = model(cal, profile);
  const cap = profile.maxWinMultiplier; const hit = profile.hitFrequency;
  const edges = [1, 2, 5, 20, 100]; // payout buckets in stakes
  const buckets = new Array(edges.length + 2).fill(0); // [no win, <1x, 1-2x, 2-5x, 5-20x, 20-100x, 100x+]
  buckets[0] = 1 - hit;
  let mean = 0; let sq = 0; let net = 0; let max = 0;
  cal.dist.forEach(([m], i) => {
    const pay = Math.min(mdl.scale * m, cap); const pr = hit * mdl.q[i];
    mean += pr * pay; sq += pr * pay * pay; if (pay > 1) net += pr; if (pr > 0 && pay > max) max = pay;
    let b = 1; while (b <= edges.length && pay >= edges[b - 1]) b += 1;
    buckets[b] += pr;
  });
  return { hitFrequency: hit, rtp: mean, houseEdge: 1 - mean, netWinFrequency: net, volatilitySd: Math.sqrt(Math.max(0, sq - mean * mean)), maxPayout: max, scale: mdl.scale, capReached: mdl.capped,
    buckets: [['No win', buckets[0]], ['<1x', buckets[1]], ['1-2x', buckets[2]], ['2-5x', buckets[3]], ['5-20x', buckets[4]], ['20-100x', buckets[5]], ['100x+', buckets[6]]] };
}

/**
 * One 'outcome' round. `drawOnce()` draws a real round of the game, `multiplierOf(round)` is its payout in stakes.
 * The win / no-win decision is one independent fair draw (`randFloat() < hitFrequency`); then real rounds are drawn
 * until one has that result (and, for a win, is kept by the volatility tilt). Returns the round, whether it is a win,
 * and the payout factor to apply to a win.
 */
export function drawProfiled({ profile, cal, drawOnce, multiplierOf, randFloat, maxTries = 5000 }) {
  const win = randFloat() < profile.hitFrequency;
  const mdl = cal?.dist?.length ? model(cal, profile) : null;
  const thin = !!mdl && mdl.alpha !== 0;
  let round = drawOnce();
  for (let i = 0; i < maxTries; i += 1) {
    const m = multiplierOf(round);
    if ((m > 0) === win && (!win || !thin || randFloat() < accept(m, mdl.alpha, mdl.m0))) break;
    round = drawOnce();
  }
  const actuallyWin = multiplierOf(round) > 0;
  return { round, win: actuallyWin, scale: actuallyWin ? outcomeScale(profile, cal) : 0 };
}

/** Payout factor of a fixed-chance 'rtp' game (dice, cups): its own RTP -> the configured one. */
export const rtpFactor = (key, profile) => (NATURAL_RTP[key] ? profile.rtp / NATURAL_RTP[key] : 1);

export const validBet = (profile, stake) => typeof stake === 'number' && Number.isFinite(stake) && stake >= profile.minBet && stake <= profile.maxBet;

/** The amount a request bets: `stake`, or the total of `bets` (roulette and the live tables place several bets at once); null if neither. */
export function betTotalOf(body) {
  if (typeof body?.stake === 'number') return body.stake;
  const b = body?.bets;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const vals = Object.values(b);
  if (vals.length === 0 || !vals.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return Math.round(vals.reduce((a, v) => a + v, 0) * 100) / 100;
}
