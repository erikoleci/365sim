// CHAIN GAMES (Penalty Shootout, Gold Tower): every step you pick one of `doors`; `traps` of them are bad.
// Draws happen on the server when you pick. Each safe pick multiplies the prize at 97% fair odds; cash out any time after one.
export const CHAIN_RTP = 0.97;
export const CHAIN_MAX = 1000;
export const roundMult = (m) => Math.floor(m * 100) / 100;

export const stepMultiplier = ({ doors, traps }) => (CHAIN_RTP * doors) / (doors - traps);

// random distinct positions 0..doors-1
export function drawTraps({ doors, traps }, randInt) {
  const pool = Array.from({ length: doors }, (_, i) => i);
  const out = [];
  for (let i = 0; i < traps; i += 1) out.push(pool.splice(randInt(pool.length), 1)[0]);
  return out.sort((a, b) => a - b);
}

export function playStep({ cfg, total, steps, choice }, randInt) {
  if (!Number.isInteger(choice) || choice < 0 || choice >= cfg.doors) return { error: 'INVALID_CHOICE' };
  const traps = drawTraps(cfg, randInt);
  if (traps.includes(choice)) return { safe: false, traps, total: 0 };
  const total2 = Math.min(CHAIN_MAX, roundMult(total * stepMultiplier(cfg)));
  const nextSteps = steps + 1;
  return { safe: true, traps, total: total2, steps: nextSteps, finished: nextSteps >= cfg.maxSteps || total2 >= CHAIN_MAX };
}

export const PENALTY_CFG = { doors: 3, traps: 1, maxSteps: 10 };
export const TOWER_LEVELS = {
  easy: { doors: 4, traps: 1, maxSteps: 10 },
  medium: { doors: 3, traps: 1, maxSteps: 10 },
  hard: { doors: 2, traps: 1, maxSteps: 10 },
  expert: { doors: 3, traps: 2, maxSteps: 8 },
};
