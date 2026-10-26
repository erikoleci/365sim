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
    expect(block(live(), 'Minuta e Golit', '1-15')).toBe('NOT_VERIFIABLE_LIVE');
    expect(block(live(), 'Gol brenda 10 minutash', 'Po')).toBe('NOT_VERIFIABLE_LIVE');
    // next goal / corner / card by side is open in play (settled from the events after the bet);
    // minute windows and player options stay closed
    expect(block(live(), 'Goli i radhës', '1')).toBeNull();
    expect(block(live(), 'Goli i radhës', 'Dybala')).toBe('NOT_VERIFIABLE_LIVE');
    expect(block(live(), 'Gol brenda 5 minutash', 'Po')).toBe('NOT_VERIFIABLE_LIVE');
  });
  it('player markets are never offered, before or during the match', () => {
    expect(block(live(), 'Shënuesi i golit', 'Mbappe')).toBe('NO_PLAYER_DATA');
    expect(block(live(), 'Lojtari Shënon', 'Haaland')).toBe('NO_PLAYER_DATA');
    expect(block(live(), 'Goli i Parë', 'Mbappe')).toBe('NO_PLAYER_DATA'); // player option of a goal-order market
    expect(block(live(), 'Goli i Parë', 'Lens')).toBe('NOT_VERIFIABLE_LIVE'); // side option: only closed live
    const pre = live({ status: 'UPCOMING', live_status: null, start_time: new Date(NOW + 3600000).toISOString(), live_home_score: null, live_away_score: null });
    expect(block(pre, 'Shënuesi i golit', 'Mbappe')).toBe('NO_PLAYER_DATA');
    expect(block(pre, 'Goli i Parë', 'Mbappe')).toBe('NO_PLAYER_DATA');
    expect(block(pre, 'Goli i Parë', 'Lens')).toBeNull();
    expect(block(pre, 'Goli i Parë', 'Asnjë')).toBeNull();
  });
  it('hidePlayerOdds drops player markets and player options but keeps the sides', async () => {
    const { hidePlayerOdds } = await import('../server/marketRules.js');
    const markets = [
      { name: 'Rezultat Final', options: [{ id: 'HOME', name: '1' }] },
      { name: 'Shënuesi i golit', options: [{ id: 'a', name: 'Mbappe' }] },
      { name: 'Goli i Parë', options: [{ id: 'a', name: 'Mbappe' }, { id: 'b', name: 'Lens' }, { id: 'c', name: 'Asnjë' }, { id: 'd', name: '2' }] },
      { name: 'Goli i Fundit', options: [{ id: 'a', name: 'Mbappe' }] },
    ];
    const out = hidePlayerOdds(markets, 'Lens', 'Sporting');
    expect(out.map((m) => m.name)).toEqual(['Rezultat Final', 'Goli i Parë']);
    expect(out[1].options.map((o) => o.name)).toEqual(['Lens', 'Asnjë', '2']);
  });
  it('no environment variable reopens unverifiable live markets', () => {
    process.env.LIVE_BET_UNVERIFIED_MARKETS = 'allow';
    try { expect(block(live(), 'Shuma e korneve', '5+')).toBe('NOT_VERIFIABLE_LIVE'); }
    finally { delete process.env.LIVE_BET_UNVERIFIED_MARKETS; }
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

import { determineLegOutcome } from '../server/matchSettlement.js';
describe('corners / cards settle automatically from the final counters', () => {
  const base = { winner: 'HOME', totalGoals: 2, bothScored: false, homeScore: 2, awayScore: 0 };
  const stats = { cornersHome: 7, cornersAway: 4, cardsHome: 2, cardsAway: 3 };
  const leg = (market_name, selection_name) => ({ market_id: 'x_m1', market_name, selection_id: selection_name, selection_name, match_home: 'Viking', match_away: 'Bayern' });
  const o = (l, s = stats) => determineLegOutcome(l, { ...base, stats: s });
  it('over/under corners and cards', () => {
    expect(o(leg('Shuma e korneve', 'Lart 10.5'))).toBe('WON');
    expect(o(leg('Shuma e korneve', 'Poshtë 10.5'))).toBe('LOST');
    expect(o(leg('Totali i kartonave', 'Lart 4.5'))).toBe('WON');
    expect(o(leg('Shuma e korneve', 'Lart 11'))).toBe('VOID');
  });
  it('"5+" and "3-5" corner labels', () => {
    expect(o(leg('Shuma e korneve P1+P2', '11+'))).toBe('WON');
    expect(o(leg('Shuma e korneve P1+P2', '12+'))).toBe('LOST');
    expect(o(leg('Shuma e korneve', '9-12'))).toBe('WON');
  });
  it('team corners use that team only', () => {
    expect(o(leg('Kornera Viking', 'Lart 6.5'))).toBe('WON');
    expect(o(leg('Kornera Bayern', 'Lart 6.5'))).toBe('LOST');
  });
  it('stays pending without counters or with an unknown label', () => {
    expect(o(leg('Shuma e korneve', 'Lart 10.5'), null)).toBeNull();
    expect(o(leg('Shuma e korneve P1+P2', '5+|6+'))).toBeNull();
    expect(o(leg('Karton i kuq', 'Po'))).toBeNull();
  });
});

describe('the provider "next" markets are open in play while they are the next event', () => {
  const live = (h, a) => ({ home_team: 'Chanmari FC', away_team: 'MLS FC', status: 'LIVE', live_status: '1H', start_time: new Date(Date.now() - 20 * 60000).toISOString(), live_minute: '20:00', live_home_score: h, live_away_score: a });
  const g = (row, name, sel) => getBetBlockReason(row, { id: 'm', name }, { id: sel, name: sel });
  it('first goal (team) is open at 0-0 and closed once a goal was scored', () => {
    expect(g(live(0, 0), 'Shenon golin e pare (skuadra)', '1')).toBeNull();
    expect(g(live(0, 0), 'Shenon golin e pare (skuadra)', 'X')).toBeNull(); // X = no goal
    expect(g(live(1, 0), 'Shenon golin e pare (skuadra)', '1')).toBe('OUTCOME_DECIDED');
  });
  it('second goal (team) is open exactly at one goal', () => {
    expect(g(live(1, 0), 'Shenon golin e dyte (skuadra)', '2')).toBeNull();
    expect(g(live(0, 0), 'Shenon golin e dyte (skuadra)', '2')).toBe('OUTCOME_DECIDED');
    expect(g(live(1, 1), 'Shenon golin e dyte (skuadra)', '2')).toBe('OUTCOME_DECIDED');
  });
  it('first corner / first card pass the sync check (counters are read at placement); a player option does not', () => {
    expect(g(live(0, 0), 'Godet kornen e pare', '1')).toBeNull();
    expect(g(live(0, 0), 'Merr kartonin e pare', '2')).toBeNull();
    expect(g(live(0, 0), 'Merr kartonin e pare', 'Dybala')).not.toBeNull();
  });
  it('the last corner market is open in play until the end is too close', () => {
    expect(g(live(1, 0), 'Godet kornen e fundit', '1')).toBeNull();
    expect(g({ ...live(1, 0), live_minute: '56:12' }, 'Godet kornen e fundit', '2')).toBeNull();
    expect(g({ ...live(1, 0), live_minute: '89:30' }, 'Godet kornen e fundit', '2')).toBe('NOT_VERIFIABLE_LIVE');
    expect(g(live(1, 0), 'Godet kornen e fundit', 'Dybala')).not.toBeNull();
  });
});
