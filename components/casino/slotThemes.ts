// Every slot gets its own cabinet: frame, backdrop pattern, ornaments, spin button and title style. The look lives in casino.css
// (`.sg-root[data-sgt=...]` sets CSS variables); this file only says which game wears which theme.
export type SlotTheme = 'classic' | 'egypt' | 'gems' | 'western' | 'asia' | 'nordic' | 'space' | 'candy' | 'aztec' | 'ocean' | 'magic' | 'sport';
const MAP: Record<string, SlotTheme> = {
  'hot-fruits': 'classic', 'blazing-sevens': 'classic', 'fire-fruits-40': 'classic', 'mega-hot-100': 'classic', 'lucky-seven-wheel': 'classic', 'fruit-carnival': 'classic',
  'pharaoh-gold': 'egypt', 'desert-explorer': 'egypt',
  'diamond-rush': 'gems', 'royal-gems': 'gems', 'golden-lady': 'gems', 'jester-jackpot': 'gems',
  'wild-west-gold': 'western', 'gold-miner': 'western',
  'lucky-dragon': 'asia', 'samurai-blade': 'asia',
  'viking-fortune': 'nordic', 'mystic-wolf': 'nordic', 'arctic-fortune': 'nordic',
  'space-odyssey': 'space', 'night-racer': 'space',
  'candy-blast': 'candy',
  'aztec-sun': 'aztec', 'jungle-safari': 'aztec',
  'ocean-pearls': 'ocean', 'pirate-treasure': 'ocean',
  'merlin-spell': 'magic', 'emerald-clover': 'magic', 'money-rush': 'magic',
  'football-fever': 'sport',
};
export const slotTheme = (id: string): SlotTheme => MAP[id] || 'classic';
// Decorations beside the marquee line, per theme.
export const THEME_ORN: Record<SlotTheme, [string, string]> = {
  classic: ['★', '★'], egypt: ['𓂀', '𓂀'], gems: ['◆', '◆'], western: ['✦', '✦'], asia: ['❖', '❖'], nordic: ['ᛟ', 'ᛟ'],
  space: ['✧', '✧'], candy: ['●', '●'], aztec: ['▲', '▲'], ocean: ['≋', '≋'], magic: ['✺', '✺'], sport: ['⚽', '⚽'],
};
