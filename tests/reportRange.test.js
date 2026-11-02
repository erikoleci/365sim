import { describe, it, expect } from 'vitest';
import { reportRange, zonedMidnight, parseDay, finishMetrics, emptyMetrics } from '../server/commission.js';
import { monthRange } from '../server/routes/agent.js';

const TZ = 'Europe/Tirane';
const HOUR = 3600000;

describe('finance report: day range in local time', () => {
  it('one day = [local midnight, next local midnight)', () => {
    const r = reportRange({ from: '2026-11-01', to: '2026-11-01' }, monthRange, TZ);
    expect(r.rangeStart).toBe(Date.UTC(2026, 10, 1) - HOUR); // Tirane is UTC+1 in November
    expect(r.rangeEnd - r.rangeStart).toBe(24 * HOUR);
    expect(r.label).toBe('2026-11-01');
  });
  it('a whole month 01/10 - 31/10 spans the DST change (25 h on 25 Oct 2026)', () => {
    const r = reportRange({ from: '2026-10-01', to: '2026-10-31' }, monthRange, TZ);
    expect(r.rangeStart).toBe(Date.UTC(2026, 9, 1) - 2 * HOUR); // UTC+2 in summer
    expect(r.rangeEnd).toBe(Date.UTC(2026, 10, 1) - HOUR);
    expect(r.rangeEnd - r.rangeStart).toBe((31 * 24 + 1) * HOUR);
    expect(reportRange({ from: '2026-10-25', to: '2026-10-25' }, monthRange, TZ).rangeEnd - zonedMidnight(2026, 10, 25, TZ)).toBe(25 * HOUR);
  });
  it('both ends are included, a reversed range is swapped, one date alone is one day', () => {
    const a = reportRange({ from: '2026-11-03', to: '2026-11-01' }, monthRange, TZ);
    const b = reportRange({ from: '2026-11-01', to: '2026-11-03' }, monthRange, TZ);
    expect(a).toEqual(b);
    expect(b.rangeEnd - b.rangeStart).toBe(3 * 24 * HOUR);
    expect(reportRange({ to: '2026-11-05' }, monthRange, TZ).label).toBe('2026-11-05');
  });
  it('invalid dates are ignored and fall back to the month / all parameters', () => {
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('x')).toBeNull();
    expect(reportRange({ from: '2026-13-01', month: '2026-03' }, monthRange, TZ).label).toBe('2026-03');
    expect(reportRange({ month: 'all' }, monthRange, TZ).label).toBe('all');
  });
});

describe('finance report: the figures of the screenshots', () => {
  const m = (o) => ({ ...emptyMetrics(), ...o });
  it('owner screen: xhiro 91, fitim 0, commission 7.28 (8%) -> diferenca 83.72, % agjentit 7.28, kompania 83.72', () => {
    expect(finishMetrics(m({ xhiro: 91, fitim: 0, pending: 21, activeTickets: 1, tickets: 5, commission: 7.28 })))
      .toMatchObject({ xhiro: 91, fitim: 0, pending: 21, diferenca: 83.72, percAgjentit: 7.28, kompania: 83.72 });
  });
  it('agent finance page: xhiro 5432.50 - fitimi 4920.52 - perqindja 203.00 = diferenca 308.98', () => {
    expect(finishMetrics(m({ xhiro: 5432.5, fitim: 4920.52, commission: 203 })).diferenca).toBe(308.98);
  });
  it('Visi213: xhiro 200, fitimi 0, perqindja 16 -> diferenca 184', () => {
    expect(finishMetrics(m({ xhiro: 200, fitim: 0, commission: 16 })).diferenca).toBe(184);
  });
});
