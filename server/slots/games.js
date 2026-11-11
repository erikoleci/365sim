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
  'viking-fortune': { scale: 0.8617, rtp: 95.05 },
  'space-odyssey': { scale: 2.7812, rtp: 95.01 },
  'mystic-wolf': { scale: 1.301, rtp: 94.94 },
  'candy-blast': { scale: 2.5154, rtp: 95.13 },
  'aztec-sun': { scale: 1.3225, rtp: 94.89 },
  'blazing-sevens': { scale: 2.5119, rtp: 94.74 },
  'fire-fruits-40': { scale: 1.0083, rtp: 94.96 },
  'mega-hot-100': { scale: 2.5302, rtp: 94.96 },
  'fruit-carnival': { scale: 2.7901, rtp: 95.22 },
  'money-rush': { scale: 2.781, rtp: 95.01 },
  'merlin-spell': { scale: 1.0238, rtp: 94.99 },
  'ocean-pearls': { scale: 2.6363, rtp: 95.01 },
  'desert-explorer': { scale: 1.3876, rtp: 95.05 },
  'golden-lady': { scale: 1.9588, rtp: 95.10 },
  'emerald-clover': { scale: 0.8514, rtp: 94.97 },
  'royal-gems': { scale: 2.9427, rtp: 95.00 },
  'jester-jackpot': { scale: 2.7659, rtp: 95.02 },
  'pirate-treasure': { scale: 1.1214, rtp: 94.98 },
  'arctic-fortune': { scale: 2.515, rtp: 95.04 },
  'jungle-safari': { scale: 1.3401, rtp: 94.91 },
  'samurai-blade': { scale: 2.7094, rtp: 94.86 },
  'football-fever': { scale: 1.0806, rtp: 94.98 },
  'gold-miner': { scale: 0.8585, rtp: 95.03 },
  'lucky-seven-wheel': { scale: 2.3819, rtp: 95.00 },
  'night-racer': { scale: 2.7869, rtp: 94.98 },
};

// Games that would otherwise share a pay shape with another game get their own: every pay is nudged by a fixed pseudo-random
// factor (seeded by `variant`, counts stay in non-decreasing order), then the scale is re-tuned so the game's RTP stays ~95%.
function perturb(shape, variant) {
  const rnd = mulberry32(variant * 7919);
  return Object.fromEntries(Object.entries(shape).map(([sym, p]) => {
    const out = []; let prev = 0;
    p.forEach((v) => { const x = Math.max(prev, Math.round(v * (0.75 + rnd() * 0.5) * 10) / 10); out.push(x); prev = x; });
    return [sym, out];
  }));
}

const def = (id, o) => {
  const { scale, rtp } = TUNE[id];
  const { symbolIds, shape: baseShape, variant, ...rest } = o;
  const shape = variant ? perturb(baseShape, variant) : baseShape;
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
const viking = ids('RUNE', 'HORN', 'AXE', 'SHIELD', 'SHIP', 'RAVEN', 'ODIN');
const space = ids('STAR', 'MOON', 'COMET', 'SATURN', 'ROCKET', 'ALIEN', 'GALAXY');
const wolf = ids('PAW', 'FEATHER', 'ARROW', 'TOTEM', 'EAGLE', 'BEAR', 'WOLF');
const candy = ids('GUMMY', 'LOLLI', 'DONUT', 'CUPCAKE', 'ICECREAM', 'CAKE', 'CHOCO');
const aztec = ids('MASK', 'CORN', 'JAGUAR', 'SERPENT', 'TEMPLE', 'CALENDAR', 'GOLDMASK');

export const SLOT_GAMES = [
  def('hot-fruits', {
    name: 'Hot Fruits', tagline: 'The fruit classic with a wild star', volatility: 'Low', color: ['#7f1d1d', '#111827'], seed: 11,
    symbolIds: fruits, shape: shapeOf(fruits, CLASSIC), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { CHERRY: '🍒', LEMON: '🍋', ORANGE: '🍊', GRAPE: '🍇', WATERMELON: '🍉', BELL: '🔔', SEVEN: '7️⃣', WILD: '⭐', SCATTER: '🍀' },
    scatterName: 'Clover', wildName: 'Star',
  }),
  def('pharaoh-gold', {
    name: "Pharaoh's Gold", tagline: 'Wild that expands over the whole reel', volatility: 'Medium', color: ['#78350f', '#1c1917'], seed: 23,
    symbolIds: pharaoh, shape: shapeOf(pharaoh, STEADY), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { PALM: '🌴', JAR: '🏺', BEETLE: '🪲', EYE: '👁️', SNAKE: '🐍', FALCON: '🦅', PHARAOH: '👑', WILD: '☀️', SCATTER: '📖' },
    scatterName: 'Libri', wildName: 'Sun (expanding)',
  }),
  def('diamond-rush', {
    name: 'Diamond Rush', tagline: 'Gems, big wins, high risk', volatility: 'High', color: ['#1e3a8a', '#0f172a'], seed: 37,
    symbolIds: diamond, shape: shapeOf(diamond, VOLATILE), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { BLUE: '🟦', GREEN: '🟩', YELLOW: '🟨', PURPLE: '🟪', RING: '💍', CROWN: '👑', DIAMOND: '💎', WILD: '✨', SCATTER: '🔮' },
    scatterName: 'Orb', wildName: 'Spark',
  }),
  def('wild-west-gold', {
    name: 'Wild West Gold', tagline: 'Sheriff, horses and gold. Expanding wild', volatility: 'Medium', color: ['#92400e', '#1f2937'], seed: 41,
    symbolIds: west, shape: shapeOf(west, CLASSIC), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { CACTUS: '🌵', BOOT: '🥾', BEER: '🍺', GUN: '🔫', HORSE: '🐎', COWBOY: '🤠', GOLD: '🪙', WILD: '⭐', SCATTER: '💰' },
    scatterName: 'Golden sack', wildName: 'Sheriff star (expanding)',
  }),
  def('lucky-dragon', {
    name: 'Lucky Dragon', tagline: 'The dragon of fortune, x3 free spins', volatility: 'High', color: ['#14532d', '#1c1917'], seed: 53,
    symbolIds: dragon, shape: shapeOf(dragon, BALANCED), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { BAMBOO: '🎋', LANTERN: '🏮', COOKIE: '🥠', ENVELOPE: '🧧', FISH: '🐟', TIGER: '🐯', DRAGON: '🐉', WILD: '☯️', SCATTER: '🪙' },
    scatterName: 'Monedha', wildName: 'Yin-Yang',
  }),
  def('viking-fortune', {
    name: 'Viking Fortune', tagline: 'Northern longships and the treasure of Odin', volatility: 'Medium', color: ['#1e3a5f', '#0b1220'], seed: 67,
    symbolIds: viking, shape: shapeOf(viking, BALANCED), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { RUNE: 'ᚱ', HORN: '📯', AXE: '🪓', SHIELD: '🛡️', SHIP: '⛵', RAVEN: '🐦‍⬛', ODIN: '🧙', WILD: '⚡', SCATTER: '🪙' },
    scatterName: 'Monedha e Odinit', wildName: 'Rrufeja (zgjerohet)',
  }),
  def('space-odyssey', {
    name: 'Space Odyssey', tagline: 'A journey among the stars, x3 free spins', volatility: 'High', color: ['#312e81', '#020617'], seed: 71,
    symbolIds: space, shape: shapeOf(space, VOLATILE), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { STAR: '⭐', MOON: '🌙', COMET: '☄️', SATURN: '🪐', ROCKET: '🚀', ALIEN: '👽', GALAXY: '🌌', WILD: '🛸', SCATTER: '🌠' },
    scatterName: 'Shooting star', wildName: 'Flying saucer',
  }),
  def('mystic-wolf', {
    name: 'Mystic Wolf', tagline: 'The night wolf, expanding wild', volatility: 'Medium', color: ['#334155', '#0f172a'], seed: 79,
    symbolIds: wolf, shape: shapeOf(wolf, STEADY), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { PAW: '🐾', FEATHER: '🪶', ARROW: '🏹', TOTEM: '🗿', EAGLE: '🦅', BEAR: '🐻', WOLF: '🐺', WILD: '🌕', SCATTER: '🔥' },
    scatterName: 'Tribal fire', wildName: 'Full moon (expanding)',
  }),
  def('candy-blast', {
    name: 'Candy Blast', tagline: 'Sweets and frequent wins', volatility: 'Low', color: ['#9d174d', '#3b0764'], seed: 83,
    symbolIds: candy, shape: shapeOf(candy, CLASSIC), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { GUMMY: '🍬', LOLLI: '🍭', DONUT: '🍩', CUPCAKE: '🧁', ICECREAM: '🍦', CAKE: '🎂', CHOCO: '🍫', WILD: '🌈', SCATTER: '🎁' },
    scatterName: 'Gift', wildName: 'Ylber',
  }),
  def('aztec-sun', {
    name: 'Aztec Sun', tagline: 'The sun temple, big wins', volatility: 'High', color: ['#7c2d12', '#1c1917'], seed: 89,
    symbolIds: aztec, shape: shapeOf(aztec, VOLATILE), freeSpinMultiplier: 3, wildExpand: true,
    symbols: { MASK: '🎭', CORN: '🌽', JAGUAR: '🐆', SERPENT: '🐍', TEMPLE: '🛕', CALENDAR: '🗓️', GOLDMASK: '👺', WILD: '☀️', SCATTER: '💎' },
    scatterName: 'Gemstone', wildName: 'Sun (expanding)',
  }),
  def('blazing-sevens', {
    name: "Blazing 7s", tagline: "Blazing fruits and burning sevens", volatility: "Low", color: ["#991b1b", "#1a0a0a"], seed: 97, category: "Classic",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], CLASSIC), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { S1: "🍒", S2: "🍋", S3: "🍊", S4: "🍇", S5: "🍉", S6: "🔔", S7: "7️⃣", WILD: "⭐", SCATTER: "🔥" },
    scatterName: "Flaka", wildName: "Star",
  }),
  def('fire-fruits-40', {
    name: "Fire Fruits 40", tagline: "Klasiku me 40 linja zjarri", volatility: "Medium", color: ["#b45309", "#1c0f05"], seed: 101, category: "Classic",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], BALANCED), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { S1: "🍒", S2: "🍋", S3: "🍊", S4: "🍇", S5: "🍉", S6: "🍀", S7: "7️⃣", WILD: "🔥", SCATTER: "🌟" },
    scatterName: "Golden star", wildName: "Fire (expanding)",
  }),
  def('mega-hot-100', { variant: 1,
    name: "Mega Hot 100", tagline: "The super classic, frequent payouts", volatility: "Low", color: ["#7f1d1d", "#0f0f1a"], seed: 103, category: "Classic",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], CLASSIC), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { S1: "🍒", S2: "🍋", S3: "🍊", S4: "🍇", S5: "🍉", S6: "⭐", S7: "7️⃣", WILD: "🃏", SCATTER: "💎" },
    scatterName: "Diamond", wildName: "Xhokeri",
  }),
  def('fruit-carnival', {
    name: "Fruit Carnival", tagline: "Fruit carnival with a wheel of fortune", volatility: "Medium", color: ["#9d174d", "#312e81"], seed: 107, category: "Classic",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], STEADY), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { S1: "🍓", S2: "🍑", S3: "🍍", S4: "🥝", S5: "🍉", S6: "🍒", S7: "🔔", WILD: "🍀", SCATTER: "🎡" },
    scatterName: "Wheel of fortune", wildName: "Clover",
  }),
  def('money-rush', {
    name: "Money Rush", tagline: "Money, money and even more money", volatility: "High", color: ["#14532d", "#052e16"], seed: 109, category: "Classic",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], VOLATILE), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { S1: "💵", S2: "💴", S3: "🪙", S4: "💳", S5: "🏦", S6: "🤑", S7: "💰", WILD: "🎰", SCATTER: "💎" },
    scatterName: "Diamond", wildName: "Jackpot",
  }),
  def('merlin-spell', {
    name: "Merlin's Spell", tagline: "The wizard, the dragon and the power of the wand", volatility: "High", color: ["#3b0764", "#0c0a1f"], seed: 113, category: "Fantasy",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], VOLATILE), freeSpinMultiplier: 3, wildExpand: true,
    symbols: { S1: "🧪", S2: "📜", S3: "🕯️", S4: "🔮", S5: "🐉", S6: "🏰", S7: "🧙", WILD: "✨", SCATTER: "⭐" },
    scatterName: "Ylli magjik", wildName: "Magjia (zgjerohet)",
  }),
  def('ocean-pearls', { variant: 4,
    name: "Ocean Pearls", tagline: "Dolphins, shells and deep pearls", volatility: "Medium", color: ["#075985", "#082f49"], seed: 127, category: "Adventure",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], STEADY), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { S1: "🐚", S2: "🦀", S3: "🐠", S4: "🐙", S5: "🐢", S6: "🐬", S7: "🦪", WILD: "🌊", SCATTER: "🫧" },
    scatterName: "Flluska", wildName: "Vala",
  }),
  def('desert-explorer', {
    name: "Desert Explorer", tagline: "The explorer and the book of secrets", volatility: "High", color: ["#92400e", "#1c1917"], seed: 131, category: "Adventure",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], VOLATILE), freeSpinMultiplier: 3, wildExpand: true,
    symbols: { S1: "🧭", S2: "🗺️", S3: "🏺", S4: "🐫", S5: "🔦", S6: "🤠", S7: "🏜️", WILD: "🧭", SCATTER: "📖" },
    scatterName: "Libri", wildName: "Busulla (zgjerohet)",
  }),
  def('golden-lady', {
    name: "Golden Lady", tagline: "The golden lady and her jewels", volatility: "Medium", color: ["#831843", "#1f0a14"], seed: 137, category: "Fantasy",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], BALANCED), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { S1: "♠️", S2: "♥️", S3: "♦️", S4: "♣️", S5: "💍", S6: "👒", S7: "👸", WILD: "💎", SCATTER: "🌹" },
    scatterName: "Rose", wildName: "Diamond",
  }),
  def('emerald-clover', {
    name: "Emerald Clover", tagline: "Clover, rainbow and the pot of gold", volatility: "Medium", color: ["#166534", "#052e16"], seed: 139, category: "Fantasy",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], BALANCED), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { S1: "🍀", S2: "🍺", S3: "🎩", S4: "🌈", S5: "🪙", S6: "🧚", S7: "☘️", WILD: "🌈", SCATTER: "🏺" },
    scatterName: "Ena e arit", wildName: "Ylberi (zgjerohet)",
  }),
  def('royal-gems', { variant: 5,
    name: "Royal Gems", tagline: "Royal gems", volatility: "Medium", color: ["#4c1d95", "#1e1b4b"], seed: 149, category: "Classic",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], STEADY), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { S1: "🟥", S2: "🟦", S3: "🟩", S4: "🟨", S5: "💎", S6: "👑", S7: "🏆", WILD: "💜", SCATTER: "✨" },
    scatterName: "Spark", wildName: "Amethyst",
  }),
  def('jester-jackpot', { variant: 6,
    name: "Jester Jackpot", tagline: "The jester and lucky cards", volatility: "High", color: ["#065f46", "#022c22"], seed: 151, category: "Fantasy",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], VOLATILE), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { S1: "🎲", S2: "🎯", S3: "🎪", S4: "🎈", S5: "🃏", S6: "🤡", S7: "🎰", WILD: "🃏", SCATTER: "🎁" },
    scatterName: "Gift", wildName: "Jester",
  }),
  def('pirate-treasure', {
    name: "Pirate Treasure", tagline: "Pirates and the treasure map", volatility: "High", color: ["#1e3a8a", "#0b1020"], seed: 157, category: "Adventure",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], VOLATILE), freeSpinMultiplier: 3, wildExpand: true,
    symbols: { S1: "⚓", S2: "🧭", S3: "🗡️", S4: "🦜", S5: "🏴‍☠️", S6: "🚢", S7: "💰", WILD: "💀", SCATTER: "🗺️" },
    scatterName: "Harta", wildName: "Kafka (zgjerohet)",
  }),
  def('arctic-fortune', { variant: 2,
    name: "Arctic Fortune", tagline: "Penguins and lucky ice", volatility: "Low", color: ["#0e7490", "#083344"], seed: 163, category: "Adventure",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], CLASSIC), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { S1: "❄️", S2: "⛄", S3: "🧊", S4: "🐧", S5: "🐻‍❄️", S6: "🦭", S7: "🏔️", WILD: "🌟", SCATTER: "🌨️" },
    scatterName: "Stuhia", wildName: "Ylli polar",
  }),
  def('jungle-safari', {
    name: "Jungle Safari", tagline: "Safari with the lion and the elephant", volatility: "Medium", color: ["#365314", "#14210a"], seed: 167, category: "Adventure",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], STEADY), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { S1: "🌴", S2: "🦜", S3: "🐍", S4: "🦒", S5: "🐘", S6: "🦁", S7: "🦏", WILD: "🐅", SCATTER: "🥁" },
    scatterName: "Daulle", wildName: "Tigri (zgjerohet)",
  }),
  def('samurai-blade', { variant: 7,
    name: "Samurai Blade", tagline: "The samurai blade and sakura", volatility: "High", color: ["#7f1d1d", "#18181b"], seed: 173, category: "Fantasy",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], VOLATILE), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { S1: "🌸", S2: "🎎", S3: "🏯", S4: "🍵", S5: "⛩️", S6: "🥷", S7: "⚔️", WILD: "🐉", SCATTER: "🏮" },
    scatterName: "Lanterns", wildName: "Dragon",
  }),
  def('football-fever', {
    name: "Football Fever", tagline: "The football slot: balls, goals and cups", volatility: "Medium", color: ["#166534", "#0a1f12"], seed: 179, category: "Sport",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], BALANCED), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { S1: "👟", S2: "🧤", S3: "🥅", S4: "📣", S5: "🏟️", S6: "⚽", S7: "🏆", WILD: "🟨", SCATTER: "🏅" },
    scatterName: "Medal", wildName: "Yellow card (expanding)",
  }),
  def('gold-miner', {
    name: "Gold Miner", tagline: "The miner and the gold mine", volatility: "Medium", color: ["#78350f", "#1a1208"], seed: 181, category: "Adventure",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], BALANCED), freeSpinMultiplier: 2, wildExpand: true,
    symbols: { S1: "⛏️", S2: "🪨", S3: "🔦", S4: "🚂", S5: "🧨", S6: "🤠", S7: "🥇", WILD: "💣", SCATTER: "💎" },
    scatterName: "Diamond", wildName: "Dinamiti (zgjerohet)",
  }),
  def('lucky-seven-wheel', { variant: 3,
    name: "Lucky Seven Wheel", tagline: "Sevens and the wheel of fortune", volatility: "Low", color: ["#9a3412", "#1c0a05"], seed: 191, category: "Classic",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], CLASSIC), freeSpinMultiplier: 2, wildExpand: false,
    symbols: { S1: "🍒", S2: "🍋", S3: "🍇", S4: "🍉", S5: "🔔", S6: "💎", S7: "7️⃣", WILD: "⭐", SCATTER: "🎡" },
    scatterName: "Rrota", wildName: "Star",
  }),
  def('night-racer', { variant: 8,
    name: "Night Racer", tagline: "Sports cars and night racing", volatility: "High", color: ["#0f172a", "#1e1b4b"], seed: 193, category: "Sport",
    symbolIds: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"], shape: shapeOf(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], VOLATILE), freeSpinMultiplier: 3, wildExpand: false,
    symbols: { S1: "⛽", S2: "🔧", S3: "🚦", S4: "🏁", S5: "🚓", S6: "🏎️", S7: "🏆", WILD: "⚡", SCATTER: "🏁" },
    scatterName: "Flamuri", wildName: "Rrufeja",
  }),
];

export const getSlotGame = (id) => SLOT_GAMES.find((g) => g.id === id) || null;

// What the browser may know about a game: no reel strips (they are the server's), everything the player is shown.
export const publicGame = (g) => ({
  id: g.id, name: g.name, tagline: g.tagline, volatility: g.volatility, color: g.color, symbols: g.symbols,
  rtp: g.rtp, lines: g.lines, paytable: g.paytable, scatterPay: g.scatterPay, freeSpins: g.freeSpins,
  category: g.category, freeSpinMultiplier: g.freeSpinMultiplier, wildExpand: g.wildExpand, scatterName: g.scatterName, wildName: g.wildName,
});
