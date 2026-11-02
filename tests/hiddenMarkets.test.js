import { describe, it, expect } from 'vitest';
import { hidePlayerOdds, isHiddenMarketName, getBetBlockReason } from '../server/marketRules.js';
import { buildCoverageReport } from '../server/marketCoverage.js';

const ET = { id: 'x1', name: 'A do te kete kohe shtese?', options: [{ id: 'Yes', name: 'Yes' }, { id: 'No', name: 'No' }] };
const OK = { id: 'x2', name: 'Gol/JoGol', options: [{ id: 'Po', name: 'Po' }] };

describe('hidden markets', () => {
  it('recognises the extra-time market', () => {
    expect(isHiddenMarketName('A do te kete kohe shtese?')).toBe(true);
    expect(isHiddenMarketName('Gol/JoGol')).toBe(false);
    expect(isHiddenMarketName('Home  no bet')).toBe(true);
    expect(isHiddenMarketName('Away no bet')).toBe(true);
    expect(isHiddenMarketName('Draw no bet')).toBe(false);
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
