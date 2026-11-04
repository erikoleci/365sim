import { describe, it, expect } from 'vitest';
import { determineLegOutcome, goalOrderFromEvents } from '../server/matchSettlement.js';
import { describeMarket, isHiddenMarketName, nthGoalSpec } from '../server/marketRules.js';

const leg = (market_name, selection_name) => ({ market_id: 'x_m1', market_name, selection_name, selection_id: selection_name });
const ctx = (o = {}) => ({ homeScore: 2, awayScore: 1, htHome: 1, htAway: 0, ...o });

describe('markets that had no rule (from the coverage report)', () => {
  it('Pjesa pare / Pjesa dyte = result of the 1st half / result of the 2nd half on its own (like 45/90)', () => {
    // HT 1-0, FT 2-1 -> first half 1, second half 1-1 = X
    expect(determineLegOutcome(leg('Pjesa pare / Pjesa dyte', '1-X'), ctx())).toBe('WON');
    expect(determineLegOutcome(leg('Pjesa pare / Pjesa dyte', '1-1'), ctx())).toBe('LOST');
    expect(determineLegOutcome(leg('Pjesa pare / Pjesa dyte', 'X-1'), ctx())).toBe('LOST');
    expect(determineLegOutcome(leg('Pjesa pare / Pjesa dyte', '1-X'), ctx({ htHome: undefined, htAway: undefined }))).toBeNull();
  });

  it('Gol JoGol Pjesa 1 Live: both teams score in the first half', () => {
    expect(determineLegOutcome(leg('Gol JoGol Pjesa 1 Live', 'Po'), ctx({ htHome: 1, htAway: 1, homeScore: 1, awayScore: 1 }))).toBe('WON');
    expect(determineLegOutcome(leg('Gol JoGol Pjesa 1 Live', 'Jo'), ctx({ htHome: 1, htAway: 1, homeScore: 1, awayScore: 1 }))).toBe('LOST');
    expect(determineLegOutcome(leg('Gol JoGol Pjesa 1 Live', 'Jo'), ctx({ htHome: 1, htAway: 0 }))).toBe('WON');
    expect(determineLegOutcome(leg('Gol JoGol Pjesa 1 Live', 'Po'), ctx({ htHome: undefined, htAway: undefined }))).toBeNull();
  });

  it('Skuadra qe kualifikohet is the same market as To qualify (1 / 2 on the aggregate)', () => {
    const c = ctx({ aggregate: { home: 3, away: 2 } });
    expect(determineLegOutcome(leg('Skuadra qe kualifikohet', '1'), c)).toBe('WON');
    expect(determineLegOutcome(leg('Skuadra qe kualifikohet', '2'), c)).toBe('LOST');
    expect(determineLegOutcome(leg('Skuadra qe kualifikohet', '1'), ctx({ aggregate: { home: 2, away: 2 } }))).toBeNull(); // tied: extra time / penalties not in the feed
  });

  describe('Nth goal (trete / peste / 1 Pjesa1 / 2 Pjesa1): 1 / X / 2 = scoring team / no such goal', () => {
    const rows = [{ team: 'H', created_at: 1 }, { team: 'A', created_at: 2 }, { team: 'H', created_at: 3 }];
    const order = goalOrderFromEvents(rows, 'H', 'A', 2, 1); // goals: home, away, home
    it('goalOrderFromEvents lists the side of every goal', () => {
      expect(order.sides).toEqual(['HOME', 'AWAY', 'HOME']);
    });
    it('third goal of the match', () => {
      const c = ctx({ goalOrder: order });
      expect(determineLegOutcome(leg('Shenon golin e trete (skuadra)', '1'), c)).toBe('WON');
      expect(determineLegOutcome(leg('Shenon golin e trete (skuadra)', '2'), c)).toBe('LOST');
      expect(determineLegOutcome(leg('Shenon golin e trete (skuadra)', 'X'), c)).toBe('LOST');
    });
    it('fifth goal does not exist -> X wins, the sides lose', () => {
      const c = ctx({ goalOrder: order });
      expect(determineLegOutcome(leg('Shenon golin e peste (skuadra)', 'X'), c)).toBe('WON');
      expect(determineLegOutcome(leg('Shenon golin e peste (skuadra)', '1'), c)).toBe('LOST');
    });
    it('first / second goal of the FIRST HALF (HT 1-0: one goal before the break)', () => {
      const c = ctx({ goalOrder: order }); // HT 1-0
      expect(determineLegOutcome(leg('Shenon Golin e 1 Pjesa1', '1'), c)).toBe('WON');
      expect(determineLegOutcome(leg('Shenon Golin e 1 Pjesa1', '2'), c)).toBe('LOST');
      expect(determineLegOutcome(leg('Shenon Golin e 2 Pjesa1', 'X'), c)).toBe('WON'); // only one goal in the half
      expect(determineLegOutcome(leg('Shenon Golin e 2 Pjesa1', '2'), c)).toBe('LOST');
    });
    it('stays PENDING when the goal order cannot be trusted or the half-time score is missing', () => {
      expect(determineLegOutcome(leg('Shenon golin e trete (skuadra)', '1'), ctx({ goalOrder: undefined }))).toBeNull();
      expect(determineLegOutcome(leg('Shenon Golin e 1 Pjesa1', '1'), ctx({ goalOrder: order, htHome: undefined, htAway: undefined }))).toBeNull();
      expect(goalOrderFromEvents([{ team: 'H', created_at: 1 }, { team: 'A', created_at: 1 }, { team: 'H', created_at: 3 }], 'H', 'A', 2, 1).sides[0]).toBeUndefined(); // two sides at the same instant
    });
  });
});

describe('coverage: which of the 13 now have a rule', () => {
  it.each([
    'Pjesa pare / Pjesa dyte', 'Gol JoGol Pjesa 1 Live', 'Skuadra qe kualifikohet',
    'Shenon Golin e 1 Pjesa1', 'Shenon Golin e 2 Pjesa1', 'Shenon golin e trete (skuadra)', 'Shenon golin e peste (skuadra)',
  ])('%s auto-settles', (name) => {
    expect(describeMarket(null, name).autoSettles).toBe(true);
  });
  it.each(['Fitohet Loja mbas Penalltive', 'Fitohet Loja ne Shtese', 'Menyra e Fitores'])('%s needs extra-time / penalty data the feed lacks: hidden, not offered', (name) => {
    expect(isHiddenMarketName(name)).toBe(true);
  });
  it('nthGoalSpec only matches those names', () => {
    expect(nthGoalSpec('shenon golin e trete (skuadra)')).toEqual({ n: 3, half1: false });
    expect(nthGoalSpec('shenon golin e 2 pjesa1')).toEqual({ n: 2, half1: true });
    expect(nthGoalSpec('shenon golin e dyte (skuadra)')).toBeNull();
  });
});

describe('markets whose options carry no line are hidden (nothing to settle)', () => {
  it('hides the live goals-of-one-team and first-half Asian total markets, keeps the ones with lines', async () => {
    const { isHiddenMarketName } = await import('../server/marketRules.js');
    for (const n of ['Sa Gola do shenohen nga ekipi vendas', 'Sa Gola do shenohen nga ekipi udhetues', 'Lart/Poshtë Gola Aziatikë në Pjesën e 1rë']) expect(isHiddenMarketName(n)).toBe(true);
    for (const n of ['Lart/Poshte Gola Aziatik ne Pjesen 1', 'Lart/Poshtë Gola Aziatikë', 'Numri i Golave Pritesi', 'Sa Gola Shënohen në Pjesën e 1re']) expect(isHiddenMarketName(n)).toBe(false);
  });
});

describe('more ordinal goal markets (2026-11-04 audit)', () => {
  it('Nth goal of the match up to the tenth, and of the first half for any N', () => {
    expect(nthGoalSpec('shenon golin e katert (skuadra)')).toEqual({ n: 4, half1: false });
    expect(nthGoalSpec('shenon golin e gjashte (skuadra)')).toEqual({ n: 6, half1: false });
    expect(nthGoalSpec('shenon golin e nente (skuadra)')).toEqual({ n: 9, half1: false });
    expect(nthGoalSpec('shenon golin e 3 pjesa1')).toEqual({ n: 3, half1: true });
    expect(nthGoalSpec('shenon golin e 5 pjesa1')).toEqual({ n: 5, half1: true });
  });
  it('third / fourth goal before a minute have a rule and decide from the goal timeline', async () => {
    const { parseProviderMarket, providerOutcome } = await import('../server/providerMarkets.js');
    const spec = parseProviderMarket('goli i trete shenohet perpara min. 70:00');
    expect(spec).toEqual({ type: 'goal_before', k: 3, side: null, minute: 70 });
    const tl = [{ minute: 10, side: 'HOME' }, { minute: 40, side: 'AWAY' }, { minute: 66, side: 'HOME' }];
    expect(providerOutcome(spec, 'po', { goalTimeline: tl })).toBe('WON');
    expect(providerOutcome(spec, 'jo', { goalTimeline: tl })).toBe('LOST');
    const s4 = parseProviderMarket('goli i katert shenohet perpara min. 80:00');
    expect(providerOutcome(s4, 'po', { goalTimeline: tl })).toBe('LOST');
    const t3 = parseProviderMarket('goli i trete i udhetuesit perpara min. 70:00');
    expect(providerOutcome(t3, 'jo', { goalTimeline: tl })).toBe('WON');
  });
});

describe('markets with no settlement rule are hidden (audit 2026-11-04)', () => {
  it('hides the three families the feed cannot settle', () => {
    for (const n of ['Menyra Golit te 3-te', 'Goditje Total Pritesi - 10.5', 'Goditje Total Udhetuesi - 19.5', 'L/P GPP 6.5', 'L/P GPU 5.5']) expect(isHiddenMarketName(n)).toBe(true);
    for (const n of ['Rezultat Final', 'Numri i Golave Pritesi', 'Lart/Poshtë Korne']) expect(isHiddenMarketName(n)).toBe(false);
  });
});
