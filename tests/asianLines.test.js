import { describe, it, expect } from 'vitest';
import { lineParts, combineParts, asianHandicapOutcome as ah, asianTotalOutcome as at } from '../server/asianLines.js';
import { ticketOutcome } from '../server/ticketOutcome.js';

describe('lineParts', () => {
  it('whole / half lines stay as they are, quarter lines split in two neighbours', () => {
    expect(lineParts(0)).toEqual([0]);
    expect(lineParts(-1.5)).toEqual([-1.5]);
    expect(lineParts(0.25)).toEqual([0, 0.5]);
    expect(lineParts(-0.25)).toEqual([-0.5, 0]);
    expect(lineParts(0.75)).toEqual([0.5, 1]);
    expect(lineParts(-1.25)).toEqual([-1.5, -1]);
    expect(lineParts(2.75)).toEqual([2.5, 3]);
    expect(lineParts(0.1)).toBeNull();
  });
});

describe('Asian handicap (own goals + line vs opponent goals)', () => {
  it('whole line: win / push / lose', () => {
    expect(ah(2, 0, -1)).toBe('WON');
    expect(ah(1, 0, -1)).toBe('VOID');
    expect(ah(0, 0, -1)).toBe('LOST');
  });
  it('half line: win / lose, never a push', () => {
    expect(ah(1, 0, -0.5)).toBe('WON');
    expect(ah(0, 0, -0.5)).toBe('LOST');
    expect(ah(0, 1, 1.5)).toBe('WON');
  });
  it('quarter line -0.25 (half on 0, half on -0.5): full win / half loss / full loss', () => {
    expect(ah(1, 0, -0.25)).toBe('WON');
    expect(ah(0, 0, -0.25)).toBe('HALF_LOST');
    expect(ah(0, 1, -0.25)).toBe('LOST');
  });
  it('quarter line +0.25 (half on 0, half on +0.5): full win / half win / full loss', () => {
    expect(ah(1, 0, 0.25)).toBe('WON');
    expect(ah(0, 0, 0.25)).toBe('HALF_WON');
    expect(ah(0, 1, 0.25)).toBe('LOST');
  });
  it('quarter line -0.75 (half on -0.5, half on -1): win by 2+, half win by exactly 1, loss otherwise', () => {
    expect(ah(2, 0, -0.75)).toBe('WON');
    expect(ah(1, 0, -0.75)).toBe('HALF_WON'); // wins on -0.5, push on -1
    expect(ah(0, 0, -0.75)).toBe('LOST');
  });
  it('quarter line +0.75 (half on +0.5, half on +1): draw wins, loss by one is a half loss', () => {
    expect(ah(1, 1, 0.75)).toBe('WON');
    expect(ah(0, 1, 0.75)).toBe('HALF_LOST'); // loses on +0.5, push on +1
    expect(ah(0, 2, 0.75)).toBe('LOST');
  });
  it('quarter line -1.25 and +1.25', () => {
    expect(ah(3, 1, -1.25)).toBe('WON');
    expect(ah(2, 1, -1.25)).toBe('HALF_LOST'); // -1.5 lost, -1 push
    expect(ah(1, 1, -1.25)).toBe('LOST');
    expect(ah(1, 1, 1.25)).toBe('WON');
    expect(ah(0, 1, 1.25)).toBe('HALF_WON'); // lost by one: +1 push, +1.5 win
    expect(ah(0, 2, 1.25)).toBe('LOST');
  });
  it('missing numbers or an odd line give nothing', () => {
    expect(ah(NaN, 0, -0.25)).toBeNull();
    expect(ah(1, 0, -0.33)).toBeNull();
  });
});

describe('Asian over / under', () => {
  it('whole line: push when the total equals it', () => {
    expect(at(true, 2, 3)).toBe('WON');
    expect(at(true, 2, 2)).toBe('VOID');
    expect(at(true, 2, 1)).toBe('LOST');
    expect(at(false, 2, 2)).toBe('VOID');
    expect(at(false, 2, 1)).toBe('WON');
  });
  it('over 2.25 (half on 2, half on 2.5): 2 goals half loss, 3 goals win, 1 goal loss', () => {
    expect(at(true, 2.25, 3)).toBe('WON');
    expect(at(true, 2.25, 2)).toBe('HALF_LOST');
    expect(at(true, 2.25, 1)).toBe('LOST');
  });
  it('over 2.75 (half on 2.5, half on 3): 3 goals half win, 4 win, 2 loss', () => {
    expect(at(true, 2.75, 4)).toBe('WON');
    expect(at(true, 2.75, 3)).toBe('HALF_WON');
    expect(at(true, 2.75, 2)).toBe('LOST');
  });
  it('under 2.25: 2 goals half win, 1 win, 3 loss;  under 2.75: 3 goals half loss', () => {
    expect(at(false, 2.25, 2)).toBe('HALF_WON');
    expect(at(false, 2.25, 1)).toBe('WON');
    expect(at(false, 2.25, 3)).toBe('LOST');
    expect(at(false, 2.75, 3)).toBe('HALF_LOST');
    expect(at(false, 2.75, 2)).toBe('WON');
  });
});

describe('combineParts', () => {
  it('every pair', () => {
    expect(combineParts(['WON', 'WON'])).toBe('WON');
    expect(combineParts(['WON', 'VOID'])).toBe('HALF_WON');
    expect(combineParts(['VOID', 'LOST'])).toBe('HALF_LOST');
    expect(combineParts(['LOST', 'LOST'])).toBe('LOST');
    expect(combineParts(['VOID', 'VOID'])).toBe('VOID');
    expect(combineParts(['WON', 'LOST'])).toBeNull();
  });
});

describe('ticketOutcome: what a ticket pays', () => {
  const leg = (status, odds) => ({ status, odds });
  it('single legs: full win, half win, push, half loss, full loss', () => {
    expect(ticketOutcome(100, [leg('WON', 2)])).toEqual({ status: 'WON', payout: null, totalOdds: null }); // stored return is used
    expect(ticketOutcome(100, [leg('HALF_WON', 2)])).toEqual({ status: 'WON', payout: 150, totalOdds: 1.5 });
    expect(ticketOutcome(100, [leg('VOID', 2)])).toEqual({ status: 'VOID', payout: 100, totalOdds: 1 });
    expect(ticketOutcome(100, [leg('HALF_LOST', 2)])).toEqual({ status: 'WON', payout: 50, totalOdds: 0.5 });
    expect(ticketOutcome(100, [leg('LOST', 2)])).toEqual({ status: 'LOST', payout: 0, totalOdds: null });
  });
  it('accumulators multiply each leg by its factor; a lost leg decides at once; pending waits', () => {
    // WON x2 (factor 2) and HALF_WON at 1.8 (factor 1.4): 100 x 2.8 = 280
    expect(ticketOutcome(100, [leg('WON', 2), leg('HALF_WON', 1.8)])).toEqual({ status: 'WON', payout: 280, totalOdds: 2.8 });
    // a half loss on a leg at 2 (factor 0.5) after a win at 2: 100 x 1 = 100 back
    expect(ticketOutcome(100, [leg('WON', 2), leg('HALF_LOST', 2)])).toEqual({ status: 'WON', payout: 100, totalOdds: 1 });
    expect(ticketOutcome(100, [leg('VOID', 3), leg('HALF_WON', 2)])).toEqual({ status: 'WON', payout: 150, totalOdds: 1.5 });
    expect(ticketOutcome(100, [leg('LOST', 2), leg('PENDING', 2)])).toEqual({ status: 'LOST', payout: 0, totalOdds: null });
    expect(ticketOutcome(100, [leg('WON', 2), leg('PENDING', 2)]).status).toBe('PENDING');
    expect(ticketOutcome(100, [leg('HALF_WON', 2), leg('PENDING', 2)]).status).toBe('PENDING');
  });
  it('void legs drop out of an ordinary ticket (unchanged behaviour)', () => {
    expect(ticketOutcome(100, [leg('WON', 2), leg('VOID', 3)])).toEqual({ status: 'WON', payout: 200, totalOdds: 2 });
    expect(ticketOutcome(100, [leg('VOID', 2), leg('VOID', 3)])).toEqual({ status: 'VOID', payout: 100, totalOdds: 1 });
  });
});
