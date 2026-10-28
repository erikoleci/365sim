import { describe, it, expect } from 'vitest';
import { normalizeMatchDetail } from '../server/bast3000/normalize.js';

// Trimmed from a real capture (Milan - Bologna).
const sample = {
  ndeshja: { match: { det: { m: {
    home: 'Milan', away: 'Bologna', data: '2026-10-28T18:30:00', ora: '18:30',
    kampionati: '    Italy - Serie A', loc_id: '372', ndeshje_id: '2553353', sport_id_rel: '1',
  } } } },
  kuotat: { nd: { n: [
    {
      grp_id_rel: '26', grpName: 'RF', rubrika: 'Rezultat Final',
      cat: { ca: { c: { id: '1', category: 'Main', grp_id_rel: '26' } } },
      odds: { odd: { o: [
        { koefi: '1.75', koefi_id: '24101504', vlere: '1', grp_detail_id_rel: '86', haGol: null },
        { koefi: '3.70', koefi_id: '24101505', vlere: 'X', grp_detail_id_rel: '87', haGol: null },
        { koefi: '5.25', koefi_id: '24101506', vlere: '2', grp_detail_id_rel: '88', haGol: null },
      ] } },
    },
    {
      grp_id_rel: '3637', grpName: 'H.E PJ1', rubrika: 'Handikap Europian Pjesa e Pare',
      odds: { odd: { o: [
        { koefi: '6.91', koefi_id: '24104550', vlere: '1 (0:1)', haGol: '0:1' },
        { koefi: '1.00', koefi_id: '24104551', vlere: 'X (0:1)', haGol: '0:1' },
      ] } },
    },
    { grp_id_rel: '99', rubrika: 'Tregu pa kuota', odds: { odd: { o: [] } } },
  ] } },
};

describe('normalizeMatchDetail', () => {
  const ev = normalizeMatchDetail(sample);

  it('maps the match, with the kickoff converted from Central European time to UTC', () => {
    expect(ev.id).toBe('bast3000-2553353');
    expect(ev.homeTeam).toBe('Milan');
    expect(ev.awayTeam).toBe('Bologna');
    expect(ev.league).toBe('Italy - Serie A');
    expect(ev.sportId).toBe('1');
    expect(ev.startTime).toBe('2026-10-28T17:30:00.000Z'); // 18:30 CET (UTC+1 after the DST change)
  });

  it('maps markets and options with numeric prices', () => {
    const rf = ev.markets.find((m) => m.name === 'Rezultat Final');
    expect(rf.category).toBe('Main');
    expect(rf.options.map((o) => [o.name, o.odds])).toEqual([['1', 1.75], ['X', 3.7], ['2', 5.25]]);
    expect(rf.suspended).toBe(false);
  });

  it('flags placeholder prices (<= 1.01) as suspended and keeps handicap labels', () => {
    const he = ev.markets.find((m) => m.name === 'Handikap Europian Pjesa e Pare');
    expect(he.options[0].name).toBe('1 (0:1)');
    expect(he.options[1].suspended).toBe(true);
    expect(he.options[0].suspended).toBe(false);
  });

  it('drops markets without options and accepts a single option given as an object', () => {
    expect(ev.markets.some((m) => m.name === 'Tregu pa kuota')).toBe(false);
    const single = JSON.parse(JSON.stringify(sample));
    single.kuotat.nd.n = [{ grp_id_rel: '5', rubrika: 'Gol/JoGol', odds: { odd: { o: { koefi: '1.80', koefi_id: '7', vlere: 'Gol' } } } }];
    expect(normalizeMatchDetail(single).markets[0].options).toHaveLength(1);
  });

  it('returns null for an unusable response', () => {
    expect(normalizeMatchDetail({})).toBeNull();
    expect(normalizeMatchDetail(null)).toBeNull();
  });
});
