import { describe, it, expect } from 'vitest';
import { getBetBlockReason, isLiveCardTotals, isLiveCardMarket, classifyMarket, describeMarket } from '../server/marketRules.js';
import { determineLegOutcome, readLiveCards } from '../server/matchSettlement.js';

const NOW = Date.parse('2026-10-29T20:00:00Z');
const row = (over = {}) => ({
  status: 'LIVE', live_status: '2H', home_team: 'A', away_team: 'B',
  start_time: new Date(NOW - 70 * 60000).toISOString(), live_minute: '60:00',
  live_home_score: 0, live_away_score: 0,
  live_cards: { home: 2, away: 1, fresh: true }, // 3 cards so far
  ...over,
});
const M = (name = 'Lart/Poshtë Kartona Totali') => ({ id: 'l365-1-cards', name });
const S = (name) => ({ id: name, name });
const reason = (r, sel, name) => getBetBlockReason(r, M(name), S(sel), NOW);

describe('live card totals', () => {
  it('recognises the plain card COUNT totals (full time) and nothing else', () => {
    expect(isLiveCardTotals('Lart/Poshtë Kartona')).toBe(true);
    expect(isLiveCardTotals('Lart/Poshtë Kartona Totali')).toBe(true);
    expect(isLiveCardTotals('Totali i kartonave')).toBe(true);
    expect(isLiveCardTotals('Kartona Mbi/Nen')).toBe(true);
    expect(isLiveCardMarket('Total Kartona')).toBe(true);
    // halves, teams, booking points, red cards, first card: still closed in play
    expect(isLiveCardTotals('Lart/Poshtë Kartona Pjesa 1-rë')).toBe(false);
    expect(isLiveCardTotals('Lart/Poshtë Kartona Skuadra 1')).toBe(false);
    expect(isLiveCardTotals('Pritesi Total Kartona')).toBe(false);
    expect(isLiveCardTotals('Total bookings')).toBe(false);
    expect(isLiveCardTotals('Karton i kuq')).toBe(false);
    expect(isLiveCardTotals('Merr kartonin e parë')).toBe(false);
  });

  it('is open in play with a fresh counter when nothing is decided yet (3 cards)', () => {
    expect(reason(row(), 'Lart 4.5')).toBeNull();
    expect(reason(row(), 'Poshte 3.5')).toBeNull();
    expect(reason(row(), 'Sakte 3')).toBeNull();
    expect(reason(row(), 'Lart 5.5', 'Totali i kartonave')).toBeNull();
  });

  it('closes the options the count has already decided', () => {
    expect(reason(row(), 'Lart 2.5')).toBe('OUTCOME_DECIDED'); // 3 > 2.5: Over already won
    expect(reason(row(), 'Poshte 2.5')).toBe('OUTCOME_DECIDED'); // Under already lost
    expect(reason(row(), 'Sakte 2')).toBe('OUTCOME_DECIDED');
  });

  it('stays closed when the counter is missing, stale, or the end is too close', () => {
    expect(reason(row({ live_cards: undefined }), 'Lart 4.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row({ live_cards: { home: 2, away: 1, fresh: false } }), 'Lart 4.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row({ live_minute: '89:10' }), 'Lart 4.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row(), 'Ndoshta')).toBe('NOT_VERIFIABLE_LIVE');
  });

  it('other card markets stay closed in play, and nothing changes before kick-off', () => {
    expect(reason(row(), 'Lart 1.5', 'Lart/Poshtë Kartona Skuadra 1')).toBe('NOT_VERIFIABLE_LIVE');
    expect(reason(row(), 'Lart 40.5', 'Pritesi Total Bookings')).toBe('NOT_VERIFIABLE_LIVE');
    const pre = row({ status: 'UPCOMING', live_status: null, start_time: new Date(NOW + 3600000).toISOString(), live_cards: undefined });
    expect(reason(pre, 'Lart 4.5')).toBeNull();
  });

  it('a card counter of one side is not read as the corner counter', () => {
    // corner totals still need live_corners; the card counter must not open them
    expect(getBetBlockReason(row(), { id: 'x', name: 'Lart/Poshtë Korne Totali' }, S('Lart 9.5'), NOW)).toBe('NOT_VERIFIABLE_LIVE');
  });
});

describe('settling card totals', () => {
  const leg = (selection, market = 'Lart/Poshtë Kartona Totali') => ({ market_id: 'l365-1-x', market_name: market, selection_id: selection, selection_name: selection });
  const ctx = (h, a) => ({ winner: 'HOME', totalGoals: 0, homeScore: 0, awayScore: 0, stats: { cardsHome: h, cardsAway: a } });
  it('Lart / Poshte / Sakte on the final card count (yellow + red)', () => {
    expect(determineLegOutcome(leg('Lart 4.5'), ctx(3, 2))).toBe('WON');
    expect(determineLegOutcome(leg('Poshte 4.5'), ctx(3, 2))).toBe('LOST');
    expect(determineLegOutcome(leg('Sakte 5'), ctx(3, 2))).toBe('WON');
    expect(determineLegOutcome(leg('Lart 5'), ctx(3, 2))).toBe('VOID');
  });
});

describe('readLiveCards', () => {
  const client = (rows) => ({ query: async () => ({ rows }) });
  it('reports the counter with its freshness', async () => {
    const fresh = await readLiveCards(client([{ cards_home: 2, cards_away: 1, updated_at: NOW - 5000 }]), 'm', NOW);
    expect(fresh).toMatchObject({ home: 2, away: 1, fresh: true });
    const stale = await readLiveCards(client([{ cards_home: 2, cards_away: 1, updated_at: NOW - 120000 }]), 'm', NOW);
    expect(stale.fresh).toBe(false);
  });
  it('is null without a row or without numbers', async () => {
    expect(await readLiveCards(client([]), 'm', NOW)).toBeNull();
    expect(await readLiveCards(client([{ cards_home: null, cards_away: null, updated_at: NOW }]), 'm', NOW)).toBeNull();
  });
});

describe('Handikap Aziatik is open in play like the plain handicap', () => {
  const asian = (name, selection = '1 -0.5') => getBetBlockReason(row(), { id: 'l365-1-ah', name }, S(selection), NOW);
  it('is classified as a handicap (full time and per half)', () => {
    expect(classifyMarket('x', 'Handikap Aziatik').kind).toBe('handicap');
    expect(classifyMarket('x', 'Handikap Aziatik Pjesa 2-të')).toEqual({ kind: 'handicap', period: 'H2' });
    expect(classifyMarket('x', 'Handikap Aziatik Pjesa 1-rë')).toEqual({ kind: 'handicap', period: 'H1' });
    expect(describeMarket('x', 'Handikap Aziatik').autoSettles).toBe(true);
  });
  it('is not decided by the score: every line stays open, quarter lines too', () => {
    expect(asian('Handikap Aziatik', '1 -0.5')).toBeNull();
    expect(asian('Handikap Aziatik', '2 +0.75')).toBeNull();
    expect(asian('Handikap Aziatik Pjesa 2-të', '1 -0.25')).toBeNull();
  });
  it('a first-half Asian handicap still closes after the first half', () => {
    expect(asian('Handikap Aziatik Pjesa 1-rë', '1 -0.5')).toBe('FIRST_HALF_OVER');
  });
  it('does not open the Asian TOTALS (they stay as before)', () => {
    expect(classifyMarket('x', 'Lart/Poshtë Gola Aziatike').kind).not.toBe('handicap');
  });
});

describe('more markets open in play from live data', () => {
  const R = (over = {}) => row({
    live_cards: { home: 2, away: 1, fresh: true, yellowHome: 2, yellowAway: 1, redHome: 0, redAway: 0 },
    live_home_score: 1, live_away_score: 0, ...over,
  });
  const g = (r, name, sel) => getBetBlockReason(r, { id: 'x', name }, S(sel), NOW);

  it('asian goal totals: closed once the goals reach the line (a quarter line a quarter earlier)', () => {
    expect(g(R(), 'Lart/Poshtë Gola Aziatike', 'Lart 2.5')).toBeNull();
    expect(g(R({ live_home_score: 2, live_away_score: 1 }), 'Lart/Poshtë Gola Aziatike', 'Lart 2.5')).toBe('OUTCOME_DECIDED');
    expect(g(R({ live_home_score: 2, live_away_score: 0 }), 'Lart/Poshtë Gola Aziatike', 'Lart 2.25')).toBe('OUTCOME_DECIDED');
    expect(g(R({ live_home_score: 2, live_away_score: 0 }), 'Lart/Poshtë Gola Aziatike', 'Lart 2.75')).toBeNull();
    expect(g(R(), 'Lart/Poshtë Gola Aziatike', 'Ndoshta')).toBe('NOT_VERIFIABLE_LIVE');
  });

  it('goals of the second half / of one team in the half', () => {
    // 1-0 at the whistle (ht 1-0), now 2-0: second half has 1 goal
    const r = R({ ht_home: 1, ht_away: 0, live_home_score: 2, live_away_score: 0, live_minute: '60:00' });
    expect(g(r, 'Sa gola shënohen në pjesën e 2', 'Lart 0.5')).toBe('OUTCOME_DECIDED');
    expect(g(r, 'Sa gola shënohen në pjesën e 2', 'Lart 1.5')).toBeNull();
    expect(g(r, 'Sa gola shënon Pritesi në pjesën e 2', 'Lart 0.5')).toBe('OUTCOME_DECIDED');
    expect(g(r, 'Sa gola shënon Udhëtuesi në pjesën e 2', 'Lart 0.5')).toBeNull();
  });

  it('red card Po/Jo: open while no red card, decided after one; needs a fresh counter', () => {
    expect(g(R(), 'Sending off', 'Po')).toBeNull();
    expect(g(R({ live_cards: { home: 3, away: 1, fresh: true, yellowHome: 2, yellowAway: 1, redHome: 1, redAway: 0 } }), 'Sending off', 'Jo')).toBe('OUTCOME_DECIDED');
    expect(g(R({ live_cards: { home: 2, away: 1, fresh: true, yellowHome: NaN, yellowAway: NaN, redHome: NaN, redAway: NaN } }), 'Karton i kuq', 'Po')).toBe('NOT_VERIFIABLE_LIVE');
    expect(g(R({ live_cards: undefined }), 'Sending off', 'Po')).toBe('NOT_VERIFIABLE_LIVE');
    expect(g(R(), 'Home Sending off', 'Po')).toBe('NOT_VERIFIABLE_LIVE'); // team-only red card stays closed
  });

  it('total bookings: cards under 10, booking points from 10', () => {
    expect(g(R(), 'Total bookings', 'Lart 3.5')).toBeNull();            // 3 cards
    expect(g(R(), 'Total bookings', 'Lart 2.5')).toBe('OUTCOME_DECIDED');
    expect(g(R(), 'Total bookings', 'Lart 40.5')).toBeNull();           // 30 points
    expect(g(R(), 'Total bookings', 'Lart 29.5')).toBe('OUTCOME_DECIDED');
    expect(g(R({ live_cards: { home: 2, away: 1, fresh: true, yellowHome: NaN, yellowAway: NaN, redHome: NaN, redAway: NaN } }), 'Total bookings', 'Lart 3.5')).toBe('NOT_VERIFIABLE_LIVE');
    expect(g(R(), '1st half - Total bookings', 'Lart 1.5')).toBe('FIRST_HALF_OVER'); // halves stay closed (at 60')
  });
});
