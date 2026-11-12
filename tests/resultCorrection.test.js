import { describe, it, expect } from 'vitest';
import { planMatch, planTickets } from '../server/resultCorrection.js';
const planCorrection = (match, h, a, legs, bets, overrides) => { const p = planMatch(match, h, a, legs, overrides); const tickets = planTickets(bets, p.flips); return { ...p, tickets, blocked: tickets.filter((x) => x.blocked).length }; };
const match = { result_home: 1, result_away: 1, ht_home: 1, ht_away: 0 };
const leg = (id, bet, sel, status, odds = 2) => ({ id, bet_id: bet, market_id: 'x-h2h', market_name: 'Fulltime Result', selection_id: sel, selection_name: sel, odds, status });
describe('planCorrection', () => {
  it('re-decides score-only legs and turns a lost single into WON; keeps legs that do not reproduce', () => {
    const legs = [leg(1, 'b1', 'HOME', 'LOST'), leg(2, 'b2', 'AWAY', 'LOST'), { ...leg(3, 'b3', 'HOME', 'LOST'), market_id: 'x-weird', market_name: 'Something else' }];
    const bets = new Map(legs.map((l) => [l.bet_id, { id: l.bet_id, stake: 100, status: 'LOST', potential_return: 200, legs: [l] }]));
    const p = planCorrection(match, 2, 1, legs, bets);
    // at 1-1 HOME lost and AWAY lost (draw) -> reproduces; at 2-1 HOME wins
    expect(p.rows.find((r) => r.legId === 1)).toMatchObject({ action: 'change', atNewScore: 'WON' });
    expect(p.rows.find((r) => r.legId === 2).action).toBe('keep');
    expect(p.tickets).toEqual([expect.objectContaining({ betId: 'b1', from: 'LOST', to: 'WON', payout: 200 })]);
  });
  it('blocks a ticket that was WON and would turn lost', () => {
    const l = leg(1, 'b1', 'DRAW', 'WON');
    const p = planCorrection(match, 2, 1, [l], new Map([['b1', { id: 'b1', stake: 100, status: 'WON', potential_return: 200, legs: [l] }]]));
    expect(p.blocked).toBe(1);
  });
  it('an owner override decides a manual leg, and tickets use the flips of ALL matches together', () => {
    const l1 = leg(1, 'b1', 'HOME', 'LOST');
    const corners = { id: 9, bet_id: 'b1', market_id: 'c', market_name: 'Shuma total e korneve', selection_id: '9+', selection_name: '9+', odds: 1.5, status: 'LOST' };
    const bet = { id: 'b1', stake: 100, status: 'LOST', potential_return: 300, legs: [l1, corners] };
    const noOverride = planCorrection(match, 2, 1, [l1, corners], new Map([['b1', bet]]));
    expect(noOverride.tickets[0].to).toBe('LOST');
    const withOverride = planCorrection(match, 2, 1, [l1, corners], new Map([['b1', bet]]), { 9: 'WON' });
    expect(withOverride.rows.find((r) => r.legId === 9).action).toBe('override');
    expect(withOverride.tickets[0]).toMatchObject({ to: 'WON', payout: 300 });
  });
});
