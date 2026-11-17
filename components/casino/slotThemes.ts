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
// Colour of the reel dividers and caps in the 3D window, per theme.
export const THEME_METAL: Record<SlotTheme, number> = {
  classic: 0xcfd3da, egypt: 0xc9a24a, gems: 0x9b7bff, western: 0x9a6a38, asia: 0xd13a30, nordic: 0xa8c4e4,
  space: 0x22e6ff, candy: 0xff7ab8, aztec: 0x9a8a62, ocean: 0x3fb6d6, magic: 0xb98cff, sport: 0x6fcf55,
};
