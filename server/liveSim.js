// Simulated activity for the Casino Live strip of this demo-money simulator (switch off with LIVE_SIM_ENABLED=0).
// Entries are flagged `simulated: true` and the UI says the feed includes simulated players.
const SLOT = 7000; // one possible round per 7 seconds
const WINDOW_SLOTS = 120; // ~14 minutes of history
const NAMES = ['Ar', 'Er', 'Be', 'Dr', 'Gj', 'Ke', 'Li', 'Mi', 'Ol', 'Re', 'Sa', 'Te', 'Vi', 'Xh', 'Zo', 'En', 'Fl', 'Ja', 'Kl', 'Lu'];
const TAILS = ['on', 'it', 'ar', 'is', 'jo', 'en', 'ik', 'al', 'ed', 'or'];
const GAMES = ['tumble', 'plinko', 'mines', 'wheel', 'keno', 'crash', 'hilo', 'holdwin', 'penalty', 'tower', 'horses', 'cups', 'roulette', 'blackjack', 'baccarat', 'dice', 'scratch', 'hot-fruits', 'lucky-dragon', 'diamond-rush'];
const STAKES = [50, 100, 100, 200, 250, 500, 500, 1000, 2000];
const MULTS = [0.5, 1.5, 1.5, 2, 2, 3, 4, 5, 8, 12, 25, 60];

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

export function simulatedFeed(now = Date.now()) {
  const last = Math.floor(now / SLOT);
  const out = [];
  for (let s = last; s > last - WINDOW_SLOTS; s -= 1) {
    const r = mulberry32(s * 2654435761);
    if (r() > 0.55) continue; // not every slot has a round
    const stake = pick(r, STAKES);
    const win = r() < 0.38;
    const mult = win ? pick(r, MULTS) : 0;
    const handle = `${pick(r, NAMES)}***${pick(r, TAILS).slice(-1)}`;
    out.push({ game: pick(r, GAMES), currency: 'ALL', stake, payout: Math.round(stake * mult * 100) / 100, multiplier: mult, at: s * SLOT + Math.floor(r() * SLOT), player: handle, simulated: true });
  }
  return out.filter((f) => f.at <= now).sort((a, b) => b.at - a.at);
}
export const simulatedPlayers = (now = Date.now()) => 38 + Math.floor(mulberry32(Math.floor(now / 600000))() * 55);
