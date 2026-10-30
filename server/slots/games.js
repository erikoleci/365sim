import { WILD, SCATTER } from './engine.js';

// Five video slots on one engine (5 reels x 3 rows, 10 paylines). The reel strips are fixed (20 symbols per reel,
// shuffled once with a fixed seed) and the paytable is scaled so the exact return-to-player (RTP) is ~95%.
// `rtp` is the exact value, computed by enumerating every reel position (see tests/slots.test.js, which re-checks it).
// Pays are multiples of the bet of one line (total stake / 10); scatter pays are multiples of the total stake.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// counts: { symbol: n } for one reel -> a fixed, shuffled strip.
function strip(counts, seed) {
  const list = [];
  for (const [sym, n] of Object.entries(counts)) for (let i = 0; i < n; i += 1) list.push(sym);
  const rnd = mulberry32(seed);
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Reels 1 and 5 carry no wild (a wild there would make 5-of-a-kind far too common); reels 2-4 carry one.
const reelCounts = (s, wild) => ({
  [s[0]]: wild ? 4 : 5, [s[1]]: 4, [s[2]]: 3, [s[3]]: 3, [s[4]]: 2, [s[5]]: 1, [s[6]]: 1,
  ...(wild ? { [WILD]: 1 } : {}), [SCATTER]: 1,
});
const strips = (s, seed) => [0, 1, 2, 3, 4].map((r) => strip(reelCounts(s, r >= 1 && r <= 3), seed + r * 101));

// payShape: raw pays for [3, 4, 5] of a kind per symbol (low1..low4, high1..high3) before scaling.
const pays = (shape, scale) => {
  const t = {};
  Object.entries(shape).forEach(([sym, p]) => {
    t[sym] = {};
    [3, 4, 5].forEach((n, i) => { t[sym][n] = Math.round(p[i] * scale * 20) / 20; });
  });
  return t;
};

const FREE_SPINS = { 3: 8, 4: 12, 5: 20 };
const SCATTER_PAY = (scale) => ({ 3: Math.round(2 * scale * 20) / 20, 4: Math.round(10 * scale * 20) / 20, 5: Math.round(50 * scale * 20) / 20 });

// scale: tuned so the exact RTP is ~95% (run `node scripts/tuneSlots.mjs`).
const TUNE = {
  'hot-fruits': { scale: 2.5119, rtp: 94.74 },
  'pharaoh-gold': { scale: 1.3359, rtp: 94.99 },
  'diamond-rush': { scale: 2.781, rtp: 95.01 },
  'wild-west-gold': { scale: 1.2966, rtp: 94.99 },
  'lucky-dragon': { scale: 1.7307, rtp: 94.92 },
};

const def = (id, o) => {
  const { scale, rtp } = TUNE[id];
  const { symbolIds, shape, ...rest } = o;
  return {
    id, ...rest,
    lines: 10,
    strips: strips(symbolIds, rest.seed),
    paytable: { ...pays(shape, scale), [WILD]: pays({ w: shape[symbolIds[6]] }, scale).w },
    scatterPay: SCATTER_PAY(scale),
    freeSpins: FREE_SPINS,
    rtp,
    tuneScale: scale,
  };
};

const CLASSIC = { a: [2, 5, 20], b: [2, 5, 20], c: [3, 10, 40], d: [3, 10, 40], e: [5, 25, 100], f: [10, 50, 200], g: [25, 100, 500] };
const VOLATILE = { a: [1, 3, 12], b: [1, 3, 12], c: [2, 6, 30], d: [2, 6, 30], e: [4, 20, 120], f: [12, 80, 400], g: [40, 250, 1500] };
const STEADY = { a: [2, 6, 15], b: [2, 6, 15], c: [3, 8, 25], d: [3, 8, 25], e: [5, 15, 60], f: [8, 30, 120], g: [15, 60, 300] };
const BALANCED = { a: [3, 8, 25], b: [3, 8, 25], c: [4, 12, 40], d: [4, 12, 40], e: [8, 30, 100], f: [15, 60, 250], g: [30, 150, 800] };
const shapeOf = (ids, base) => Object.fromEntries(ids.map((id, i) => [id, base['abcdefg'[i]]]));
const ids = (...s) => s;

const fruits = ids('CHERRY', 'LEMON', 'ORANGE', 'GRAPE', 'WATERMELON', 'BELL', 'SEVEN');
const pharaoh = ids('PALM', 'JAR', 'BEETLE', 'EYE', 'SNAKE', 'FALCON', 'PHARAOH');
const diamond = ids('BLUE', 'GREEN', 'YELLOW', 'PURPLE', 'RING', 'CROWN', 'DIAMOND');
const west = ids('CACTUS', 'BOOT', 'BEER', 'GUN', 'HORSE', 'COWBOY', 'GOLD');
const dragon = ids('BAMBOO', 'LANTERN', 'COOKIE', 'ENVELOPE', 'FISH', 'TIGER', 'DRAGON');

export const SLOT_GAMES = [
  def('hot-fruits', {
    name: 'Hot Fruits', tagline: 'Klasiku i frutave me yll wild', volatility: 'E ulët', color: ['#7f1d1d', '#111827'], seed: 11,
    symbolIds: fruits, shape: shapeOf(fruits, CLASSIC), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { CHERRY: '🍒', LEMON: '🍋', ORANGE: '🍊', GRAPE: '🍇', WATERMELON: '🍉', BELL: '🔔', SEVEN: '7️⃣', WILD: '⭐', SCATTER: '🍀' },
    scatterName: 'Tërfili', wildName: 'Ylli',
  }),
  def('pharaoh-gold', {
    name: "Pharaoh's Gold", tagline: 'Wild që zgjerohet mbi gjithë rrotën', volatility: 'Mesatare', color: ['#78350f', '#1c1917'], seed: 23,
    symbolIds: pharaoh, shape: shapeOf(pharaoh, STEADY), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { PALM: '🌴', JAR: '🏺', BEETLE: '🪲', EYE: '👁️', SNAKE: '🐍', FALCON: '🦅', PHARAOH: '👑', WILD: '☀️', SCATTER: '📖' },
    scatterName: 'Libri', wildName: 'Dielli (zgjerohet)',
  }),
  def('diamond-rush', {
    name: 'Diamond Rush', tagline: 'Xhevahire, fitime të mëdha, rrezik i lartë', volatility: 'E lartë', color: ['#1e3a8a', '#0f172a'], seed: 37,
    symbolIds: diamond, shape: shapeOf(diamond, VOLATILE), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { BLUE: '🟦', GREEN: '🟩', YELLOW: '🟨', PURPLE: '🟪', RING: '💍', CROWN: '👑', DIAMOND: '💎', WILD: '✨', SCATTER: '🔮' },
    scatterName: 'Sfera', wildName: 'Shkëndija',
  }),
  def('wild-west-gold', {
    name: 'Wild West Gold', tagline: 'Sherifi, kuajt dhe ari. Wild që zgjerohet', volatility: 'Mesatare', color: ['#92400e', '#1f2937'], seed: 41,
    symbolIds: west, shape: shapeOf(west, CLASSIC), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { CACTUS: '🌵', BOOT: '🥾', BEER: '🍺', GUN: '🔫', HORSE: '🐎', COWBOY: '🤠', GOLD: '🪙', WILD: '⭐', SCATTER: '💰' },
    scatterName: 'Thesi i artë', wildName: 'Yll sherifi (zgjerohet)',
  }),
  def('lucky-dragon', {
    name: 'Lucky Dragon', tagline: 'Dragoi i fatit, rrotullime falas x3', volatility: 'E lartë', color: ['#14532d', '#1c1917'], seed: 53,
    symbolIds: dragon, shape: shapeOf(dragon, BALANCED), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { BAMBOO: '🎋', LANTERN: '🏮', COOKIE: '🥠', ENVELOPE: '🧧', FISH: '🐟', TIGER: '🐯', DRAGON: '🐉', WILD: '☯️', SCATTER: '🪙' },
    scatterName: 'Monedha', wildName: 'Yin-Yang',
  }),
];

export const getSlotGame = (id) => SLOT_GAMES.find((g) => g.id === id) || null;

// What the browser may know about a game: no reel strips (they are the server's), everything the player is shown.
export const publicGame = (g) => ({
  id: g.id, name: g.name, tagline: g.tagline, volatility: g.volatility, color: g.color, symbols: g.symbols,
  rtp: g.rtp, lines: g.lines, paytable: g.paytable, scatterPay: g.scatterPay, freeSpins: g.freeSpins,
  freeSpinMultiplier: g.freeSpinMultiplier, wildExpand: g.wildExpand, scatterName: g.scatterName, wildName: g.wildName,
});
