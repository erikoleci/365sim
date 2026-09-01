import { describe, it, expect } from 'vitest';
import { outcomeId, resolveCurrentOdds, mapEventToMatch } from '../server/oddsUtils.js';

const sampleEvent = (overrides = {}) => ({
  home_team: 'Tirana',
  away_team: 'Vllaznia',
  bookmakers: [
    {
      title: 'BookA',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Tirana', price: 1.8 },
            { name: 'Draw', price: 3.4 },
            { name: 'Vllaznia', price: 4.2 },
          ],
        },
        {
          key: 'totals',
          outcomes: [
            { name: 'Over', point: 2.5, price: 1.9 },
            { name: 'Under', point: 2.5, price: 1.9 },
          ],
        },
      ],
    },
    {
      title: 'BookB',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Tirana', price: 1.95 }, // better price than BookA
            { name: 'Draw', price: 3.2 },
            { name: 'Vllaznia', price: 4.0 },
          ],
        },
      ],
    },
  ],
  ...overrides,
});

const row = (event) => ({
  id: 'match-1',
  league: 'Superliga',
  home_team: 'Tirana',
  away_team: 'Vllaznia',
  start_time: Date.now(),
  status: 'UPCOMING',
  live_home_score: null,
  live_away_score: null,
  result_home: null,
  result_away: null,
  raw_json: JSON.stringify(event),
});

describe('outcomeId', () => {
  it('maps home/away/draw team names to stable HOME/AWAY/DRAW ids', () => {
    const ev = sampleEvent();
    expect(outcomeId('h2h', { name: 'Tirana' }, ev)).toBe('HOME');
    expect(outcomeId('h2h', { name: 'Vllaznia' }, ev)).toBe('AWAY');
    expect(outcomeId('h2h', { name: 'Draw' }, ev)).toBe('DRAW');
  });

  it('includes the point in the id for lined markets (totals/spreads)', () => {
    expect(outcomeId('totals', { name: 'Over', point: 2.5 }, sampleEvent())).toBe('Over-2.5');
  });
});

describe('resolveCurrentOdds', () => {
  it('picks the BEST price across bookmakers for a given selection', () => {
    const odds = resolveCurrentOdds(row(sampleEvent()), 'match-1-h2h', 'HOME');
    expect(odds).toBe(1.95); // BookB's price beats BookA's 1.8
  });

  it('resolves a totals selection by its market+point id', () => {
    const odds = resolveCurrentOdds(row(sampleEvent()), 'match-1-totals', 'Over-2.5');
    expect(odds).toBe(1.9);
  });

  it('returns null for a market that does not exist on this match', () => {
    const odds = resolveCurrentOdds(row(sampleEvent()), 'match-1-btts', 'Yes');
    expect(odds).toBeNull();
  });

  it('returns null for a selection that does not exist within an existing market', () => {
    const odds = resolveCurrentOdds(row(sampleEvent()), 'match-1-h2h', 'NOT_A_REAL_SELECTION');
    expect(odds).toBeNull();
  });
});

describe('mapEventToMatch (dynamic/unknown markets)', () => {
  it('still renders a market whose key is not in MARKET_LABELS, with an auto-generated name/category', () => {
    const ev = sampleEvent({
      bookmakers: [
        {
          title: 'BookA',
          markets: [
            {
              key: 'player_props', // not in MARKET_LABELS on purpose
              outcomes: [{ name: 'Some Player Over 1.5', price: 2.1 }],
            },
          ],
        },
      ],
    });
    const match = mapEventToMatch(row(ev));
    const market = match.markets.find((m) => m.marketKey === 'player_props');
    expect(market).toBeDefined();
    expect(market.name).toBe('Player Props'); // auto-generated, title-cased
    expect(market.category).toBe('other');
    expect(market.options[0].odds).toBe(2.1);
  });

  it('resolveCurrentOdds also works for a market key outside MARKET_LABELS', () => {
    const ev = sampleEvent({
      bookmakers: [
        { title: 'BookA', markets: [{ key: 'corners', outcomes: [{ name: 'Over', point: 9.5, price: 1.85 }] }] },
      ],
    });
    const odds = resolveCurrentOdds(row(ev), 'match-1-corners', 'Over-9.5');
    expect(odds).toBe(1.85);
  });
});
