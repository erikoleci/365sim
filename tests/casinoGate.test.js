import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../server/casinoAccess.js', () => ({ getCasinoAccess: vi.fn() }));
import { gatedDraw } from '../server/casinoGate.js';
import { WHEEL_SEGMENTS, wheelSpin } from '../server/wheel.js';

const rng = (n) => Math.floor(Math.random() * n);
describe('win gate', () => {
  it('gate 100 leaves the draw untouched', () => {
    let wins = 0; const N = 20000;
    for (let i = 0; i < N; i += 1) if (gatedDraw(() => wheelSpin(rng), (x) => x.multiplier > 0, 100, rng).multiplier > 0) wins += 1;
    expect(Math.abs(wins / N - 0.5)).toBeLessThan(0.02);
  });
  it('gate 10 keeps about 10% of the natural wins and the paid round is the drawn round', () => {
    let wins = 0; const N = 20000;
    for (let i = 0; i < N; i += 1) {
      const r = gatedDraw(() => wheelSpin(rng), (x) => x.multiplier > 0, 10, rng);
      expect(r.multiplier).toBe(WHEEL_SEGMENTS[r.index]);
      if (r.multiplier > 0) wins += 1;
    }
    expect(wins / N).toBeGreaterThan(0.03); expect(wins / N).toBeLessThan(0.08);
  });
  it('never loops forever when every round wins', () => {
    expect(gatedDraw(() => ({ w: 1 }), () => true, 0, () => 99).w).toBe(1);
  });
});
