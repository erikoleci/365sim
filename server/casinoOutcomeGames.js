// The real draw of every 'outcome' game, with injectable randomness (`rng(n)` -> integer in [0, n)). The routes draw the
// same way; the simulations and tests use this table so they exercise the actual engines.
import { SLOT_GAMES } from './slots/games.js';
import { playRound as slotRound } from './slots/engine.js';
import * as tumble from './slots/tumble.js';
import * as holdwin from './holdwin.js';
import { GAMES as SUPER, spinReels, multiplierFor } from './slots.js';
import { wheelSpin } from './wheel.js';
import { scratchCard } from './scratch.js';

export function outcomeGames(rng) {
  const games = {
    slots: { drawOnce: () => { const g = SUPER.fruit; return { multiplier: multiplierFor(g, spinReels(g, rng)) }; }, multiplierOf: (r) => r.multiplier },
    tumble: { drawOnce: () => tumble.playRound(rng), multiplierOf: (r) => r.totalMultiplier },
    holdwin: { drawOnce: () => holdwin.playRound(rng), multiplierOf: (r) => r.multiplier },
    wheel: { drawOnce: () => wheelSpin(rng), multiplierOf: (r) => r.multiplier },
    scratch: { drawOnce: () => scratchCard(rng), multiplierOf: (r) => r.multiplier },
  };
  for (const g of SLOT_GAMES) games[`slot:${g.id}`] = { drawOnce: () => slotRound(g, rng), multiplierOf: (r) => r.totalMultiplier };
  return games;
}

/** Plays `rounds` rounds of one game through the profile pipeline. Returns what a player would really have seen. */
export function simulateProfile({ profile, cal, game, rounds, rng, randFloat, drawProfiled, outcomeScale }) {
  let paid = 0; let wins = 0; let net = 0; let sumSq = 0; let max = 0;
  const edges = [1, 2, 5, 20, 100]; const buckets = new Array(edges.length + 2).fill(0);
  const scale = outcomeScale(profile, cal);
  for (let i = 0; i < rounds; i += 1) {
    const r = drawProfiled({ profile, cal, drawOnce: game.drawOnce, multiplierOf: game.multiplierOf, randFloat });
    const m = r.win ? Math.min(game.multiplierOf(r.round) * scale, profile.maxWinMultiplier) : 0;
    paid += m; sumSq += m * m; if (m > 0) wins += 1; if (m > 1) net += 1; if (m > max) max = m;
    let b = 0; if (m > 0) { b = 1; while (b <= edges.length && m >= edges[b - 1]) b += 1; }
    buckets[b] += 1;
  }
  const mean = paid / rounds;
  return { rounds, hit: wins / rounds, netHit: net / rounds, rtp: mean, sd: Math.sqrt(Math.max(0, sumSq / rounds - mean * mean)), max, scale, buckets: buckets.map((c) => c / rounds) };
}
