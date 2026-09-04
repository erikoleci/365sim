import { describe, it, expect } from 'vitest';
import {
  parseOddString,
  mapMarketKey,
  buildEvent,
  isoFromWholeDate,
  parseScore,
  statusFromCommence,
  leagueKey,
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
  it('maps ONLY the exact main markets onto canonical keys', function () {
    expect(mapMarketKey('Rezultat Final', '1')).toBe('h2h');
    expect(mapMarketKey('1X2', '9')).toBe('h2h');
    expect(mapMarketKey('Totali i Golave', '40')).toBe('totals');
    expect(mapMarketKey('Handikap', '60')).toBe('spreads');
    expect(mapMarketKey('Dopio Shans', '3')).toBe('double_chance');
    expect(mapMarketKey('Gol/JoGol', '41')).toBe('btts');
  });

  it('gives every other market its own unique key so no coefficient is merged away', function () {
    const firstHalf = mapMarketKey('Rezultati Pjesës së Parë', '12');
    const booking = mapMarketKey('Booking 1x2', '80');
    expect(firstHalf).toBe('rezultati_pjes_s_s_par_m12');
    expect(booking).toBe('booking_1x2_m80');
    expect(firstHalf).not.toBe('h2h');
    expect(booking).not.toBe('h2h');
    // Two different provider ids for the same non-canonical name stay separate.
    expect(mapMarketKey('Korneret', '90')).not.toBe(mapMarketKey('Korneret', '91'));
  });

  it('keeps two same-named handicap markets separate inside one event', function () {
    const rows = parseOddString(
      '1|1.9|1|60|Handikap,2|1.9|2|60|Handikap,3|1.8|1|61|Handikap,4|2.0|2|61|Handikap'
    );
    const ev = buildEvent(5, 'A', 'B', '2026-09-05T18:00:00.000Z', rows);
    const markets = ev.bookmakers[0].markets;
    expect(markets).toHaveLength(2);
    expect(markets.reduce(function (n, m) { return n + m.outcomes.length; }, 0)).toBe(4);
  });

  it('decodes HTML entities in market names', function () {
    expect(mapMarketKey('Rezultat Final &amp; Numri i Golave', '70')).toBe(
      'rezultat_final_numri_i_golave_m70'
    );
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
    const rows = parseOddString('1|1.8|Mbi 2.5|77|Totali i Golave,2|2.0|Nen 2.5|77|Totali i Golave');
    const ev = buildEvent(7, 'A', 'B', '2026-09-05T18:00:00.000Z', rows);
    const totals = ev.bookmakers[0].markets.find(function (m) { return m.key === 'totals'; });
    expect(totals.outcomes).toEqual([
      { name: 'Over', price: 1.8, point: 2.5, id: '1' },
      { name: 'Under', price: 2.0, point: 2.5, id: '2' },
    ]);
  });

  it('keeps every market and coefficient separate (no silent merging)', function () {
    const rows = parseOddString(
      '1|2.09|1|1|Rezultat Final,2|3.45|X|1|Rezultat Final,3|3.45|2|1|Rezultat Final,' +
      '4|2.48|1|12|Rezultati Pjesës së Parë,5|2.10|X|12|Rezultati Pjesës së Parë,6|3.68|2|12|Rezultati Pjesës së Parë,' +
      '7|1.92|Tek|30|Tek/Cift,8|1.79|Cift|30|Tek/Cift'
    );
    const ev = buildEvent(9, 'A', 'B', '2026-09-05T18:00:00.000Z', rows);
    const markets = ev.bookmakers[0].markets;
    expect(markets).toHaveLength(3);
    const totalOutcomes = markets.reduce(function (n, m) { return n + m.outcomes.length; }, 0);
    expect(totalOutcomes).toBe(8);
    const h2h = markets.find(function (m) { return m.key === 'h2h'; });
    expect(h2h.outcomes.map(function (o) { return o.name; })).toEqual(['A', 'Draw', 'B']);
    const half = markets.find(function (m) { return m.key.indexOf('rezultati_pjes') === 0; });
    expect(half.outcomes).toHaveLength(3);
    const tek = markets.find(function (m) { return m.key.indexOf('tek_cift') === 0; });
    expect(tek.outcomes.map(function (o) { return o.name; })).toEqual(['Tek', 'Cift']);
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

describe('london365 leagueKey', function () {
  it('builds a provider_country_slug key so App.tsx groups it under the right flag', function () {
    expect(leagueKey('Premier League')).toBe('l365_england_premier_league');
    expect(leagueKey('Serie A')).toBe('l365_italy_serie_a');
    expect(leagueKey('UEFA Champions League')).toBe('l365_uefa_uefa_champions_league');
  });

  it('falls back to the "other" country token for an unrecognized league name', function () {
    expect(leagueKey('Some Obscure Regional Cup')).toBe('l365_other_some_obscure_regional_cup');
  });
});
