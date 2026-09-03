import { describe, it, expect } from 'vitest';
import {
  parseOddString,
  mapMarketKey,
  buildEvent,
  isoFromWholeDate,
  parseScore,
  statusFromCommence,
} from '../server/london365.js';

describe('london365 parseOddString', function () {
  it('parses the 5-part packed odds string', function () {
    const rows = parseOddString('101|1.85|1|55|Rezultati Final,102|3.40|X|55|Rezultati Final,103|4.20|2|55|Rezultati Final');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      coefId: '101',
      coef: 1.85,
      option: '1',
      marketId: '55',
      marketName: 'Rezultati Final',
    });
    expect(rows[1].option).toBe('X');
    expect(rows[2].option).toBe('2');
  });

  it('parses the 4-part livegames string without a market name', function () {
    const rows = parseOddString('201|2.10|Mbi 2.5|77,202|1.70|Nen 2.5|77');
    expect(rows).toHaveLength(2);
    expect(rows[0].marketName).toBeNull();
    expect(rows[1].option).toBe('Nen 2.5');
  });

  it('drops malformed or non-numeric coefficient entries', function () {
    const rows = parseOddString('301|abc|1|55|X,302|2.5|2|55|X');
    expect(rows).toHaveLength(1);
    expect(rows[0].coefId).toBe('302');
  });

  it('returns an empty array for empty input', function () {
    expect(parseOddString('')).toEqual([]);
    expect(parseOddString(null)).toEqual([]);
  });
});

describe('london365 mapMarketKey', function () {
  it('maps Albanian market labels onto canonical keys', function () {
    expect(mapMarketKey('Rezultati Final')).toBe('h2h');
    expect(mapMarketKey('1X2')).toBe('h2h');
    expect(mapMarketKey('Totali i Golave')).toBe('totals');
    expect(mapMarketKey('Handikapi Azian')).toBe('spreads');
    expect(mapMarketKey('Dopio')).toBe('double_chance');
  });

  it('slugs unknown markets instead of dropping them', function () {
    expect(mapMarketKey('Korneret Mbi')).toBe('korneret_mbi');
    expect(mapMarketKey('')).toBe('other');
  });
});

describe('london365 buildEvent', function () {
  it('groups outcomes into a canonical The-Odds-API event shape', function () {
    const rows = parseOddString('1|1.9|1|55|Rezultati Final,2|3.5|X|55|Rezultati Final,3|4.1|2|55|Rezultati Final');
    const ev = buildEvent(42, 'Arsenal', 'Chelsea', '2026-09-05T18:00:00.000Z', rows);
    expect(ev.id).toBe('l365-42');
    expect(ev.bookmakers).toHaveLength(1);
    expect(ev.bookmakers[0].title).toBe('LondonPro365');
    const markets = ev.bookmakers[0].markets;
    expect(markets).toHaveLength(1);
    expect(markets[0].key).toBe('h2h');
    const names = markets[0].outcomes.map(function (o) { return o.name; });
    expect(names).toEqual(['Arsenal', 'Draw', 'Chelsea']);
    expect(markets[0].outcomes[0].price).toBe(1.9);
  });

  it('turns Over/Under options into name plus point pairs', function () {
    const rows = parseOddString('1|1.8|Mbi 2.5|77|Totali,2|2.0|Nen 2.5|77|Totali');
    const ev = buildEvent(7, 'A', 'B', '2026-09-05T18:00:00.000Z', rows);
    const totals = ev.bookmakers[0].markets.find(function (m) { return m.key === 'totals'; });
    expect(totals.outcomes).toEqual([
      { name: 'Over', price: 1.8, point: 2.5, id: '1' },
      { name: 'Under', price: 2.0, point: 2.5, id: '2' },
    ]);
  });
});

describe('london365 date and score helpers', function () {
  it('builds an ISO timestamp from whole_date', function () {
    expect(isoFromWholeDate('2026-09-05 18:00', null, null)).toBe('2026-09-05T18:00:00.000Z');
  });

  it('falls back to game_date plus game_time', function () {
    const iso = isoFromWholeDate(null, '2026-09-05', '18:00');
    expect(iso).toBe('2026-09-05T18:00:00.000Z');
  });

  it('parses a scoreline', function () {
    expect(parseScore('2-1')).toEqual({ home: 2, away: 1 });
    expect(parseScore('not a score')).toBeNull();
  });

  it('classifies upcoming vs live by kickoff time', function () {
    expect(statusFromCommence('2999-01-01T00:00:00.000Z')).toBe('UPCOMING');
    expect(statusFromCommence('2000-01-01T00:00:00.000Z')).toBe('LIVE');
  });
});
