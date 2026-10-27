import { describe, it, expect, afterEach } from 'vitest';
import { describeMarket, getBetBlockReason, settlementRuleRequired } from '../server/marketRules.js';
import { buildCoverageReport } from '../server/marketCoverage.js';

describe('describeMarket', () => {
  it('knows which markets are settled automatically', () => {
    for (const name of ['Rezultat Final', 'Dopio Shans', 'Numri i Golave ne Ndeshje', 'Gol/Jogol', 'Rezultati i Saktë', 'Handikap', 'Tek/Çift', 'Pushim/Fund', 'Rezultat Final & Totali']) {
      expect(describeMarket('x', name).autoSettles, name).toBe(true);
    }
  });
  it('recognises per-team totals by their shape', () => {
    expect(describeMarket('x', 'Numri i Golave Zakynthos').kind).toBe('team_totals');
  });
  it('flags markets with no rule (player, timing, anything unknown)', () => {
    for (const name of ['Lojtari Shënon', 'Goli i Parë', 'Minuta e Golit', 'Diçka e Panjohur']) {
      const d = describeMarket('x', name);
      expect(d.autoSettles, name).toBe(false);
      expect(d.inPlay).toBe('blocked');
    }
  });
  it('agrees with settlement: corner/card variants the counters cannot decide are NOT claimed as settled', () => {
    for (const name of ['Pikët e Kartonave', 'Korner Pjesa e Parë', 'Korner Handikap']) {
      expect(describeMarket('x', name).autoSettles, name).toBe(false);
    }
    for (const name of ['Korner Totali', 'Kartonë Totali', 'Numri i Kornerave', 'Karton i Kuq', 'Karton i Verdhë']) {
      expect(describeMarket('x', name).autoSettles, name).toBe(true);
    }
  });
  it('says what stays open in play', () => {
    expect(describeMarket('x', 'Rezultat Final').inPlay).toBe('open');
    expect(describeMarket('x', 'Pushim/Fund').inPlay).toBe('open');
  });
});

describe('buildCoverageReport', () => {
  const report = buildCoverageReport([
    { name: 'Rezultat Final', legs: 50, pending: 2 },
    { name: 'Rezultat Final', matches: 90 },                    // same name from the board: merged
    { name: 'Lojtari Shënon', legs: 7, pending: 7 },
    { name: 'Goli i Parë', matches: 40 },
  ]);
  it('lists markets without a rule first, most used first', () => {
    expect(report.markets.map((m) => m.name)).toEqual(['Lojtari Shënon', 'Goli i Parë', 'Rezultat Final']);
  });
  it('merges one market seen in several places and totals it', () => {
    const r = report.markets.find((m) => m.name === 'Rezultat Final');
    expect(r).toMatchObject({ legs: 50, pending: 2, matches: 90 });
  });
  it('summarises how many tickets would end by manual settlement or refund', () => {
    expect(report.summary).toEqual({ markets: 3, autoSettled: 1, withoutRule: 2, betLegsWithoutRule: 7, pendingLegsWithoutRule: 7 });
  });
});

describe('BET_REQUIRE_SETTLEMENT_RULE', () => {
  afterEach(() => { delete process.env.BET_REQUIRE_SETTLEMENT_RULE; });
  const upcoming = { start_time: new Date(Date.now() + 3600e3).toISOString(), status: 'UPCOMING', home_team: 'A', away_team: 'B' };
  it('is off by default: unknown markets can still be bet on before the match', () => {
    expect(settlementRuleRequired()).toBe(false);
    expect(getBetBlockReason(upcoming, { id: 'x', name: 'Diçka e Panjohur' }, { id: 'a', name: 'Po' })).toBeNull();
  });
  it('when on: a market with no rule is refused even before kick-off, a known one is not', () => {
    process.env.BET_REQUIRE_SETTLEMENT_RULE = '1';
    expect(getBetBlockReason(upcoming, { id: 'x', name: 'Diçka e Panjohur' }, { id: 'a', name: 'Po' })).toBe('NO_SETTLEMENT_RULE');
    expect(getBetBlockReason(upcoming, { id: 'x', name: 'Rezultat Final' }, { id: '1', name: '1' })).toBeNull();
  });
});

describe('coverage text: live markets section', () => {
  it('lists the markets live matches carry and flags the ones closed live', async () => {
    const { buildCoverageReport, formatCoverageText } = await import('../server/marketCoverage.js');
    const report = buildCoverageReport([
      { name: 'Rezultat Final', matches: 5, live: 3, liveOpen: 3, samples: ['1', 'X', '2'] },
      { name: 'Korneri i Radhës', matches: 2, live: 2, liveOpen: 0, samples: ['1', '2'] },
    ]);
    const text = formatCoverageText(report);
    expect(text).toContain('TREGJET E NDESHJEVE LIVE');
    expect(text).toMatch(/- Rezultat Final \| live: 3 \| hapur: 3 \|/);
    expect(text).toMatch(/- Korneri i Radhës \| live: 2 \| hapur: 0 \(MBYLLUR live: nuk shfaqet\)/);
  });
});
