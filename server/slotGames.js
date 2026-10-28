// The slot catalogue. Each game is plain data fed to server/slotEngine.js.
//
//   symbols  low -> high value. `weight` is the chance weight of a symbol on every reel cell and
//            `pays` is [3 of a kind, 4 of a kind, 5 of a kind] as a multiple of the per-line bet
//            (total stake / 10 paylines).
//   wild     substitutes for every symbol except the scatter; only appears on `reels` (0-based).
//   scatter  pays anywhere (`pays`, multiple of the TOTAL stake) and 3+ trigger `freeSpins`, whose
//            wins are multiplied by `multiplier`.
//   rtp      the measured return-to-player in percent, checked against a seeded simulation of
//            millions of spins in tests/slotEngine.test.js. It is what the lobby shows to players.

export const SLOT_GAMES = [
  {
    id: 'fruit-frenzy',
    name: 'Fruit Frenzy',
    tagline: 'Classic fruits, frequent small wins',
    volatility: 'Low',
    rtp: 96,
    icon: '🍒',
    theme: { from: '#7f1d1d', to: '#1c1917', accent: '#facc15' },
    symbols: [
      { id: 'cherry', emoji: '🍒', name: 'Cherry', weight: 24, pays: [0.5, 2, 5] },
      { id: 'lemon', emoji: '🍋', name: 'Lemon', weight: 22, pays: [0.5, 2, 5] },
      { id: 'orange', emoji: '🍊', name: 'Orange', weight: 20, pays: [1, 3, 8] },
      { id: 'grapes', emoji: '🍇', name: 'Grapes', weight: 16, pays: [1, 4, 10] },
      { id: 'melon', emoji: '🍉', name: 'Watermelon', weight: 12, pays: [2, 6, 15] },
      { id: 'bell', emoji: '🔔', name: 'Bell', weight: 9, pays: [3, 10, 25] },
      { id: 'star', emoji: '⭐', name: 'Star', weight: 6, pays: [5, 20, 60] },
      { id: 'seven', emoji: '7️⃣', name: 'Lucky Seven', weight: 4, pays: [10, 50, 200] },
    ],
    wild: { emoji: '🃏', name: 'Joker', weight: 4, reels: [1, 2, 3] },
    scatter: {
      emoji: '💰',
      name: 'Money Bag',
      weight: 3,
      pays: { 3: 2, 4: 10, 5: 50 },
      freeSpins: { 3: 8, 4: 12, 5: 20 },
      multiplier: 2,
    },
  },
  {
    id: 'golden-pharaoh',
    name: 'Golden Pharaoh',
    tagline: 'Ancient treasures and 2x free spins',
    volatility: 'Medium',
    rtp: 96,
    icon: '👑',
    theme: { from: '#78350f', to: '#0c0a09', accent: '#fbbf24' },
    symbols: [
      { id: 'snake', emoji: '🐍', name: 'Cobra', weight: 24, pays: [0.5, 2, 6] },
      { id: 'camel', emoji: '🐪', name: 'Camel', weight: 21, pays: [0.5, 2, 6] },
      { id: 'vase', emoji: '🏺', name: 'Vase', weight: 18, pays: [1, 4, 10] },
      { id: 'scarab', emoji: '🪲', name: 'Scarab', weight: 14, pays: [2, 6, 18] },
      { id: 'eye', emoji: '👁️', name: 'Eye of Horus', weight: 10, pays: [3, 10, 30] },
      { id: 'pyramid', emoji: '🔺', name: 'Pyramid', weight: 7, pays: [5, 25, 80] },
      { id: 'pharaoh', emoji: '👑', name: 'Pharaoh', weight: 4, pays: [10, 60, 250] },
    ],
    wild: { emoji: '🌞', name: 'Sun God Ra', weight: 4, reels: [1, 2, 3] },
    scatter: {
      emoji: '📜',
      name: 'Papyrus',
      weight: 3,
      pays: { 3: 2, 4: 10, 5: 50 },
      freeSpins: { 3: 8, 4: 12, 5: 20 },
      multiplier: 2,
    },
  },
  {
    id: 'neon-nights',
    name: 'Neon Nights',
    tagline: 'Big city, big swings',
    volatility: 'High',
    rtp: 96,
    icon: '🌃',
    theme: { from: '#4c1d95', to: '#020617', accent: '#22d3ee' },
    symbols: [
      { id: 'martini', emoji: '🍸', name: 'Martini', weight: 26, pays: [0.4, 1.5, 5] },
      { id: 'dice', emoji: '🎲', name: 'Dice', weight: 22, pays: [0.4, 1.5, 5] },
      { id: 'headphones', emoji: '🎧', name: 'Headphones', weight: 18, pays: [1, 4, 12] },
      { id: 'car', emoji: '🚘', name: 'Sports Car', weight: 13, pays: [2, 8, 25] },
      { id: 'diamond', emoji: '💎', name: 'Diamond', weight: 8, pays: [4, 20, 80] },
      { id: 'city', emoji: '🌃', name: 'Skyline', weight: 5, pays: [8, 40, 200] },
      { id: 'bolt', emoji: '⚡', name: 'Lightning', weight: 3, pays: [15, 100, 500] },
    ],
    wild: { emoji: '🕶️', name: 'Shades', weight: 4, reels: [1, 2, 3] },
    scatter: {
      emoji: '🌟',
      name: 'Neon Star',
      weight: 2.5,
      pays: { 3: 3, 4: 15, 5: 75 },
      freeSpins: { 3: 10, 4: 15, 5: 25 },
      multiplier: 3,
    },
  },
  {
    id: 'wild-west',
    name: 'Wild West',
    tagline: 'Saddle up for the showdown',
    volatility: 'Medium',
    rtp: 96,
    icon: '🤠',
    theme: { from: '#9a3412', to: '#1c1917', accent: '#fb923c' },
    symbols: [
      { id: 'cactus', emoji: '🌵', name: 'Cactus', weight: 24, pays: [0.5, 2, 6] },
      { id: 'whiskey', emoji: '🥃', name: 'Whiskey', weight: 21, pays: [0.5, 2, 6] },
      { id: 'horse', emoji: '🐎', name: 'Horse', weight: 17, pays: [1, 4, 10] },
      { id: 'revolver', emoji: '🔫', name: 'Revolver', weight: 14, pays: [2, 6, 18] },
      { id: 'cowboy', emoji: '🤠', name: 'Cowboy', weight: 10, pays: [3, 12, 40] },
      { id: 'eagle', emoji: '🦅', name: 'Eagle', weight: 7, pays: [5, 25, 90] },
      { id: 'gold', emoji: '💰', name: 'Gold Sack', weight: 4, pays: [10, 60, 250] },
    ],
    wild: { emoji: '🐂', name: 'Bull', weight: 4, reels: [1, 2, 3] },
    scatter: {
      emoji: '⭐',
      name: 'Sheriff Star',
      weight: 3,
      pays: { 3: 2, 4: 10, 5: 50 },
      freeSpins: { 3: 8, 4: 12, 5: 20 },
      multiplier: 2,
    },
  },
];

export const getSlotGame = (id) => SLOT_GAMES.find((g) => g.id === id) || null;

// What the client is allowed to see (everything it needs to draw the reels and the paytable).
export function publicSlotGame(g) {
  return {
    id: g.id,
    name: g.name,
    tagline: g.tagline,
    volatility: g.volatility,
    rtp: g.rtp,
    icon: g.icon,
    theme: g.theme,
    symbols: [
      ...g.symbols.map((s) => ({ id: s.id, emoji: s.emoji, name: s.name, pays: s.pays })),
      { id: 'wild', emoji: g.wild.emoji, name: g.wild.name, pays: null },
      { id: 'scatter', emoji: g.scatter.emoji, name: g.scatter.name, pays: null },
    ],
    scatter: { pays: g.scatter.pays, freeSpins: g.scatter.freeSpins, multiplier: g.scatter.multiplier },
    paylines: 10,
  };
}
