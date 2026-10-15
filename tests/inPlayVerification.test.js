import { describe, it, expect } from 'vitest';
import { getBetBlockReason, classifyMarket, parseOverUnder } from '../server/marketRules.js';

const NOW = Date.parse('2026-10-13T20:00:00Z');
const live = (o = {}) => ({
  id: 'm1', home_team: 'Lens', away_team: 'Sporting', status: 'LIVE', live_status: '1H',
  start_time: new Date(NOW - 30 * 60000).toISOString(), live_minute: 30,
  live_home_score: 0, live_away_score: 0, ...o,
});
const block = (row, name, selId, selName = selId, id = 'x-' + name) =>
  getBetBlockReason(row, { id, name }, { id: selId, name: selName }, NOW, { allowUnverified: false });

describe('classifyMarket', () => {
  it('recognises goal-based and result markets', () => {
    expect(classifyMarket('a', 'Gol/JoGol').kind).toBe('btts');
    expect(classifyMarket('a', 'Dopio Shans').kind).toBe('double_chance');
    expect(classifyMarket('a', 'Rezultat Final').kind).toBe('result');
    expect(classifyMarket('a', 'Numri i golave').kind).toBe('totals');
    expect(classifyMarket('a', 'Shuma e korneve P1+P2').kind).toBe('corners');
    expect(classifyMarket('a', 'Karton i kuq').kind).toBe('cards');
    expect(classifyMarket('a', 'Shënuesi i golit').kind).toBe('other');
  });
  it('parses over/under', () => {
    expect(parseOverUnder('Lart 2.5')).toEqual({ side: 'Over', point: 2.5 });
    expect(parseOverUnder('Poshtë 1,5')).toEqual({ side: 'Under', point: 1.5 });
  });
});

describe('getBetBlockReason in play', () => {
  it('allows everything before kick-off', () => {
    const row = live({ status: 'UPCOMING', live_status: null, start_time: new Date(NOW + 3600000).toISOString(), live_home_score: null, live_away_score: null });
    expect(block(row, 'Shuma e korneve', '5+')).toBeNull();
  });
  it('keeps 1X2 / double chance open', () => {
    expect(block(live(), 'Rezultat Final', '1')).toBeNull();
    expect(block(live(), 'Dopio Shans', '1X')).toBeNull();
  });
  it('blocks Over once the goals already exceed the line, Under too', () => {
    const row = live({ live_home_score: 2, live_away_score: 1 });
    expect(block(row, 'Numri i golave', 'Lart 2.5')).toBe('OUTCOME_DECIDED');
    expect(block(row, 'Numri i golave', 'Poshtë 2.5')).toBe('OUTCOME_DECIDED');
    expect(block(row, 'Numri i golave', 'Lart 3.5')).toBeNull();
  });
  it('blocks BTTS once both teams scored', () => {
    expect(block(live({ live_home_score: 1, live_away_score: 1 }), 'Gol/JoGol', 'Po')).toBe('OUTCOME_DECIDED');
    expect(block(live({ live_home_score: 1, live_away_score: 0 }), 'Gol/JoGol', 'Po')).toBeNull();
  });
  it('blocks correct scores that are already impossible', () => {
    const row = live({ live_home_score: 2, live_away_score: 0 });
    expect(block(row, 'Rezultati i saktë', '1-0')).toBe('OUTCOME_DECIDED');
    expect(block(row, 'Rezultati i saktë', '2-1')).toBeNull();
  });
  it('blocks corners, cards, player and unknown markets (no live data)', () => {
    expect(block(live(), 'Shuma e korneve P1+P2', '5+')).toBe('NOT_VERIFIABLE_LIVE');
    expect(block(live(), 'Totali i kartonave', 'Lart 3.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(block(live(), 'Shënuesi i golit', 'Mbappe')).toBe('NOT_VERIFIABLE_LIVE');
  });
  it('env/option reopens unverifiable markets', () => {
    expect(getBetBlockReason(live(), { id: 'x', name: 'Shuma e korneve' }, { id: '5+' }, NOW, { allowUnverified: true })).toBeNull();
  });
  it('first-half goal market closes after half-time, even at 0-0', () => {
    const row = live({ live_status: '2H', live_minute: 55, start_time: new Date(NOW - 65 * 60000).toISOString() });
    expect(block(row, 'Numri i golave Pjesa e Parë', 'Lart 0.5')).toBe('FIRST_HALF_OVER');
  });
  it('second-half totals count only second-half goals', () => {
    const row = live({ live_status: '2H', live_minute: 55, start_time: new Date(NOW - 65 * 60000).toISOString(), live_home_score: 2, live_away_score: 0, ht_home: 2, ht_away: 0 });
    expect(block(row, 'Numri i golave Pjesa e Dytë', 'Lart 0.5')).toBeNull();
  });
  it('finished match is closed', () => {
    expect(block(live({ status: 'FINISHED' }), 'Rezultat Final', '1')).toBe('MATCH_FINISHED');
  });
});
