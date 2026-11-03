import { describe, it, expect } from 'vitest';
import { hidePlayerOdds, isHiddenMarketName, getBetBlockReason } from '../server/marketRules.js';
import { buildCoverageReport } from '../server/marketCoverage.js';

const ET = { id: 'x1', name: 'A do te kete kohe shtese?', options: [{ id: 'Yes', name: 'Yes' }, { id: 'No', name: 'No' }] };
const OK = { id: 'x2', name: 'Gol/JoGol', options: [{ id: 'Po', name: 'Po' }] };

describe('Home / Away no bet', () => {
  const home = { id: 'n1', name: 'Home No Bet', options: [{ id: '1', name: '1' }, { id: 'X', name: 'X' }, { id: '2', name: '2' }] };
  const away = { id: 'n2', name: 'Away No Bet', options: [{ id: '1', name: '1' }, { id: 'X', name: 'X' }, { id: '2', name: '2' }] };
  const row = { home_team: 'A', away_team: 'B', start_time: '2099-01-01T00:00:00Z', status: 'UPCOMING' };
  it('offers only option 1 of Home No Bet and option 2 of Away No Bet', () => {
    const out = hidePlayerOdds([home, away], 'A', 'B');
    expect(out.find((m) => m.id === 'n1').options.map((o) => o.id)).toEqual(['1']);
    expect(out.find((m) => m.id === 'n2').options.map((o) => o.id)).toEqual(['2']);
  });
  it('drops the market when the feed has no such option', () => {
    const odd = { id: 'n3', name: 'Home No Bet', options: [{ id: 'X', name: 'X' }, { id: '2', name: '2' }] };
    expect(hidePlayerOdds([odd], 'A', 'B')).toEqual([]);
  });
  it('blocks bets on the other options', () => {
    expect(getBetBlockReason(row, { id: 'n1', name: 'Home No Bet' }, { id: '1', name: '1' })).toBeNull();
    expect(getBetBlockReason(row, { id: 'n1', name: 'Home No Bet' }, { id: 'X', name: 'X' })).toBe('NO_SETTLEMENT_RULE');
    expect(getBetBlockReason(row, { id: 'n2', name: 'Away No Bet' }, { id: '2', name: '2' })).toBeNull();
    expect(getBetBlockReason(row, { id: 'n2', name: 'Away No Bet' }, { id: '1', name: '1' })).toBe('NO_SETTLEMENT_RULE');
  });
});

describe('hidden markets', () => {
  it('recognises the extra-time market', () => {
    expect(isHiddenMarketName('A do te kete kohe shtese?')).toBe(true);
    expect(isHiddenMarketName('Gol/JoGol')).toBe(false);
    expect(isHiddenMarketName('Home  no bet')).toBe(false); // offered again, option 1 only (see below)
    expect(isHiddenMarketName('Draw no bet')).toBe(false);
  });
  it('recognises the overtime, winning-method and penalty markets', () => {
    for (const n of ['Overtime & goal', 'Winning method', 'Will there be a penalty shootout']) {
      expect(isHiddenMarketName(n)).toBe(true);
    }
    // offered again: penalty kicks are logged as PENALTY events and settled in extraMarkets.js
    expect(isHiddenMarketName('A do te kete penallti gjate ndeshjes?')).toBe(false);
    expect(isHiddenMarketName('Will there be a penalty')).toBe(false);
    expect(isHiddenMarketName('To qualify')).toBe(false);
    expect(isHiddenMarketName('Gol/JoGol')).toBe(false);
  });
  it('is removed from the board but other markets stay', () => {
    expect(hidePlayerOdds([ET, OK], 'A', 'B').map((m) => m.id)).toEqual(['x2']);
  });
  it('cannot be bet on', () => {
    const row = { home_team: 'A', away_team: 'B', start_time: '2099-01-01T00:00:00Z', status: 'UPCOMING' };
    expect(getBetBlockReason(row, { id: 'x1', name: ET.name }, { id: 'Yes', name: 'Yes' })).toBe('NO_SETTLEMENT_RULE');
  });
  it('is left out of the coverage report', () => {
    const r = buildCoverageReport([{ name: ET.name, matches: 5 }, { name: 'Gol/JoGol', matches: 5 }]);
    expect(r.markets.map((m) => m.name)).toEqual(['Gol/JoGol']);
  });
});
