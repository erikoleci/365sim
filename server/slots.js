// Slot games. Pure logic, no database: the route in routes/casino.js debits, calls spin(), credits.
//
// FAIR BY CONSTRUCTION: every reel stop is drawn uniformly with crypto.randomInt from the game's reel
// strip, independently of the player, the stake, the balance or past results. There is no "win chance"
// gate and no forced loss. The return to player (RTP) is whatever the strips and the paytable give, and
// exactRtp() computes it by enumerating every combination (tests/slots.test.js pins it), so the number
// shown to the player is the real one.
//
// To add a game: add an entry to GAMES (a `strip` per reel with symbol -> number of stops, plus the
// paytable) and a test pinning its RTP. Nothing else needs to change.
import { randomInt } from 'crypto';

// Game 1: classic 3-reel fruit machine, one payline (the middle row).
//   3 of a kind pays `three[symbol]` x stake; 2 cherries on reels 1-2 pay `twoCherries` x stake.
export const GAMES = {
  fruit: {
    id: 'fruit',
    name: 'Super Slots',
    reels: 3,
    // 32 stops per reel; symbol -> how many stops carry it.
    strip: { '🍒': 8, '🍋': 7, '🍇': 6, '🔔': 5, '💎': 3, '7️⃣': 3 },
    three: { '🍒': 8, '🍋': 12, '🍇': 20, '🔔': 40, '💎': 100, '7️⃣': 300 },
    twoCherries: 2,
  },
};

export const DEFAULT_GAME = 'fruit';
export const getGame = (id) => GAMES[id ?? DEFAULT_GAME] || null;

// Flat list of stops of a reel, e.g. ['🍒','🍒',...,'7️⃣'] (32 entries).
function stops(game) {
  return Object.entries(game.strip).flatMap(([sym, n]) => Array(n).fill(sym));
}

// One uniformly random symbol per reel. `rand(n)` must return an integer in [0, n); injectable for tests.
export function spinReels(game, rand = randomInt) {
  const all = stops(game);
  return Array.from({ length: game.reels }, () => all[rand(all.length)]);
}

// Multiplier of the stake for a given result of the reels (0 = no win).
export function multiplierFor(game, reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return game.three[a] || 0;
  if (a === '🍒' && b === '🍒') return game.twoCherries || 0;
  return 0;
}

// Money has 2 decimals everywhere (NUMERIC(14,2)).
export const payoutFor = (stake, multiplier) => Number((stake * multiplier).toFixed(2));

// Exact RTP and hit frequency by enumerating every combination of stops (not a simulation).
export function exactRtp(game) {
  const syms = Object.keys(game.strip);
  const total = Object.values(game.strip).reduce((s, n) => s + n, 0);
  let rtp = 0;
  let hit = 0;
  for (const a of syms) for (const b of syms) for (const c of syms) {
    const p = (game.strip[a] / total) * (game.strip[b] / total) * (game.strip[c] / total);
    const m = multiplierFor(game, [a, b, c]);
    rtp += p * m;
    if (m > 0) hit += p;
  }
  return { rtp, hitFrequency: hit };
}

// What the player may be told about a game (no strips needed, but the paytable and the real RTP are public).
export function describeGame(game) {
  const { rtp, hitFrequency } = exactRtp(game);
  return {
    id: game.id,
    name: game.name,
    reels: game.reels,
    paytable: game.three,
    twoCherries: game.twoCherries,
    rtp: Number((rtp * 100).toFixed(2)),
    hitFrequency: Number((hitFrequency * 100).toFixed(2)),
    maxMultiplier: Math.max(...Object.values(game.three)),
  };
}
