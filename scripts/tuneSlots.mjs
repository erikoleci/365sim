// Prints the natural RTP of every slot and the scale that would bring it to the target (default 95%).
//   node scripts/tuneSlots.mjs [target] [only,ids]
// Games with up to 5 reels are enumerated exactly; 6- and 7-reel games are measured by a seeded simulation of 3M rounds.
import { SLOT_GAMES } from '../server/slots/games.js';
import { exactRtp, playRound } from '../server/slots/engine.js';
import { mulberry32 } from '../server/raceOdds.js';
const target = Number(process.argv[2]) || 95;
const only = process.argv[3] ? process.argv[3].split(',') : null;
for (const g of SLOT_GAMES) {
  if (only && !only.includes(g.id)) continue;
  let rtp; let how;
  if (g.reels <= 5) { rtp = exactRtp(g).rtp; how = 'exact'; } else {
    const r = mulberry32(g.reels * 1009 + 7); const rng = (n) => Math.floor(r() * n);
    let t = 0; const N = 3_000_000; for (let i = 0; i < N; i += 1) t += playRound(g, rng).totalMultiplier; rtp = t / N; how = 'sim 3M';
  }
  console.log(g.id.padEnd(18), `${g.reels}x3/${g.lines}L`, 'scale', g.tuneScale, 'RTP', (rtp * 100).toFixed(3) + '%', `(${how})`, '-> suggested scale', ((g.tuneScale * target) / (rtp * 100)).toFixed(4));
}
