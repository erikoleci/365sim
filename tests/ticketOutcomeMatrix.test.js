import { describe, it, expect } from 'vitest';
import { ticketOutcome } from '../server/ticketOutcome.js';

// Every WON/LOST/VOID/PENDING/HALF_WON/HALF_LOST combination for tickets of 1..5 legs.
const S = ['WON', 'LOST', 'VOID', 'PENDING', 'HALF_WON', 'HALF_LOST'];
const ODDS = [1.5, 2.2, 3.1, 1.05, 12];

function* combos(n) {
  const idx = Array(n).fill(0);
  while (true) {
    yield idx.map((i) => S[i]);
    let k = n - 1;
    while (k >= 0 && ++idx[k] === S.length) { idx[k] = 0; k--; }
    if (k < 0) return;
  }
}

const factor = (l) => (l.status === 'WON' ? l.odds
  : l.status === 'HALF_WON' ? 1 + (l.odds - 1) / 2
  : l.status === 'HALF_LOST' ? 0.5 : 1);

describe('ticketOutcome: exhaustive leg status combinations', () => {
  it('follows the settlement rules for every combination', () => {
    for (let n = 1; n <= 5; n++) {
      for (const c of combos(n)) {
        const legs = c.map((status, i) => ({ status, odds: ODDS[i] }));
        const o = ticketOutcome(10, legs);
        const lost = c.includes('LOST');
        const pending = c.includes('PENDING');
        const label = c.join(',');
        if (lost) {
          expect(o.status, label).toBe('LOST');
          expect(o.payout, label).toBe(0);
        } else if (pending) {
          expect(o.status, label).toBe('PENDING');
        } else if (c.every((x) => x === 'VOID')) {
          expect(o.status, label).toBe('VOID');
          expect(o.payout, label).toBe(10);
        } else {
          expect(o.status, label).toBe('WON');
          if (o.payout != null) {
            const t = legs.reduce((a, l) => a * factor(l), 1);
            expect(o.payout, label).toBeCloseTo(Number((10 * t).toFixed(2)), 2);
          }
        }
      }
    }
  });

  it('LOST, WON, WON closes the ticket as LOST even with PENDING legs', () => {
    const mk = (...s) => s.map((status, i) => ({ status, odds: ODDS[i] }));
    expect(ticketOutcome(10, mk('WON', 'LOST', 'WON')).status).toBe('LOST');
    expect(ticketOutcome(10, mk('PENDING', 'LOST', 'PENDING')).status).toBe('LOST');
    expect(ticketOutcome(10, mk('WON', 'PENDING')).status).toBe('PENDING');
  });
});
