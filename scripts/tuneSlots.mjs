// Prints the exact RTP of every slot and the scale that would bring it to the target (default 95%).
//   node scripts/tuneSlots.mjs [target]
import { SLOT_GAMES } from '../server/slots/games.js';
import { exactRtp } from '../server/slots/engine.js';
const target = Number(process.argv[2]) || 95;
for (const g of SLOT_GAMES) {
  const { rtp, baseEv, freeShare } = exactRtp(g);
  console.log(g.id.padEnd(16), 'scale', g.tuneScale, 'RTP', (rtp * 100).toFixed(3) + '%', 'base', (baseEv * 100).toFixed(2) + '%', 'free-spin share', (freeShare * 100).toFixed(1) + '%',
    '-> suggested scale', ((g.tuneScale * target) / (rtp * 100)).toFixed(4));
}
