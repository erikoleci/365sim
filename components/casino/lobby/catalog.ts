// Catalog of the casino lobby: what each tile shows. Game keys, routing and access keys are unchanged (see CasinoHub).
export type Category = 'all' | 'slots' | 'live' | 'table' | 'instant' | 'race';
export type GameKey = 'slots' | 'blackjack' | 'roulette' | 'poker' | 'baccarat' | 'dice' | 'plinko' | 'mines' | 'dragontiger' | 'wheel' | 'keno' | 'scratch' | 'tumble' | 'crash' | 'hilo' | 'holdwin' | 'penalty' | 'tower' | 'horses' | 'cups' | 'liveroulette' | 'livehorses' | 'dogs' | 'livedogs' | 'livecrash' | 'livekeno';
export interface Tile { key: string; game: GameKey; name: string; tagline: string; cat: Exclude<Category, 'all'>; accent: string; img?: string; art?: 'wheel' | 'keno' | 'scratch' | 'tumble'; wide?: boolean; badge?: 'LIVE' | 'HOT' | 'NEW' | 'CLASSIC' }

export const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'all', label: 'All games', icon: '◆' }, { id: 'slots', label: 'Slots', icon: '🎰' }, { id: 'live', label: 'Live', icon: '●' },
  { id: 'table', label: 'Table', icon: '♠' }, { id: 'instant', label: 'Instant', icon: '⚡' }, { id: 'race', label: 'Racing & Sport', icon: '🏁' },
];

export const TILES: Tile[] = [
  { key: 'slots', game: 'slots', name: 'Super Slots', tagline: '30 themed slot machines', cat: 'slots', accent: '#f5c542', img: 'slots', badge: 'HOT' },
  { key: 'tumble', game: 'tumble', name: 'Sugar Cascade', tagline: 'Tumbling candy wins', cat: 'slots', accent: '#ff5fa2', art: 'tumble' },
  { key: 'holdwin', game: 'holdwin', name: 'Hold & Win', tagline: 'Lock the coins, chase the grid', cat: 'slots', accent: '#ffb02e', img: 'holdwin', wide: true },
  { key: 'dogs', game: 'dogs', name: 'Dog Race', tagline: 'Pick your greyhound', cat: 'race', accent: '#34d399', img: 'dograce-start-cover', badge: 'HOT' },
  { key: 'horses', game: 'horses', name: 'Horse Race', tagline: 'Back the winner at the line', cat: 'race', accent: '#c08a4a', img: 'horses', wide: true },
  { key: 'penalty', game: 'penalty', name: 'Penalty Shootout', tagline: 'Beat the keeper, cash out', cat: 'race', accent: '#4ade80', img: 'penalty', wide: true },
  { key: 'tower', game: 'tower', name: 'Gold Tower', tagline: 'Climb higher, win bigger', cat: 'instant', accent: '#f5c542', img: 'tower', wide: true },
  { key: 'cups', game: 'cups', name: 'Three Cups', tagline: 'Follow the ball', cat: 'instant', accent: '#fb923c', img: 'cups', wide: true },
  { key: 'crash', game: 'crash', name: 'Crash', tagline: 'Cash out before it flies away', cat: 'instant', accent: '#f43f5e', img: 'crash', wide: true, badge: 'HOT' },
  { key: 'hilo', game: 'hilo', name: 'Hi-Lo', tagline: 'Higher or lower?', cat: 'instant', accent: '#a78bfa', img: 'hilo', wide: true },
  { key: 'plinko', game: 'plinko', name: 'Plinko', tagline: 'Drop the ball, hit the multiplier', cat: 'instant', accent: '#38bdf8', img: 'plinko' },
  { key: 'mines', game: 'mines', name: 'Mines', tagline: 'Find the gems, avoid the mines', cat: 'instant', accent: '#22d3ee', img: 'mines' },
  { key: 'dice', game: 'dice', name: 'Dice', tagline: 'Set your odds, roll', cat: 'instant', accent: '#e879f9', img: 'dice' },
  { key: 'wheel', game: 'wheel', name: 'Wheel of Fortune', tagline: 'One spin, big multipliers', cat: 'instant', accent: '#fbbf24', art: 'wheel' },
  { key: 'keno', game: 'keno', name: 'Keno', tagline: 'Pick your numbers', cat: 'instant', accent: '#60a5fa', art: 'keno' },
  { key: 'scratch', game: 'scratch', name: 'Scratch & Win', tagline: 'Scratch and reveal', cat: 'instant', accent: '#facc15', art: 'scratch' },
  { key: 'dragontiger', game: 'dragontiger', name: 'Dragon Tiger', tagline: 'Fast card duel', cat: 'table', accent: '#ef4444', img: 'dragontiger' },
  { key: 'baccarat', game: 'baccarat', name: 'Baccarat', tagline: 'Player, Banker or Tie', cat: 'table', accent: '#d4af37', img: 'baccarat', badge: 'CLASSIC' },
  { key: 'blackjack', game: 'blackjack', name: 'Blackjack Pro', tagline: 'Beat the dealer to 21', cat: 'table', accent: '#10b981', img: 'blackjack', badge: 'CLASSIC' },
  { key: 'roulette', game: 'roulette', name: 'Roulette', tagline: 'European single-zero', cat: 'table', accent: '#dc2626', img: 'roulette', badge: 'CLASSIC' },
  { key: 'videopoker', game: 'poker', name: 'Video Poker', tagline: 'Jacks or Better', cat: 'table', accent: '#3b82f6', img: 'videopoker' },
];

export const LIVE_TILES: Tile[] = [
  { key: 'liveroulette', game: 'liveroulette', name: 'Live Roulette', tagline: 'A new spin every minute', cat: 'live', accent: '#dc2626', img: 'liveroulette', wide: true, badge: 'LIVE' },
  { key: 'livehorses', game: 'livehorses', name: 'Live Horse Race', tagline: 'Scheduled races, shared with everyone', cat: 'live', accent: '#c08a4a', img: 'livehorses', wide: true, badge: 'LIVE' },
  { key: 'livedogs', game: 'livedogs', name: 'Live Dog Race', tagline: 'Race starts on the clock', cat: 'live', accent: '#34d399', img: 'dograce-finish-cover', badge: 'LIVE' },
  { key: 'livecrash', game: 'livecrash', name: 'Live Crash', tagline: 'Everyone rides the same rocket', cat: 'live', accent: '#f43f5e', img: 'livecrash', badge: 'LIVE' },
  { key: 'livekeno', game: 'livekeno', name: 'Live Keno', tagline: 'Shared draws, every few minutes', cat: 'live', accent: '#60a5fa', img: 'livekeno', badge: 'LIVE' },
];
