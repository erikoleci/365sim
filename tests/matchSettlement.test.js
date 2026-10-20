import { describe, it, expect, beforeAll } from 'vitest';
import { determineLegOutcome } from '../server/matchSettlement.js';

const leg = (market_id, selection_id) => ({ market_id, selection_id });

describe('determineLegOutcome — 1X2 (h2h)', () => {
  it('settles HOME as WON when the home team wins', () => {
    expect(determineLegOutcome(leg('m1-h2h', 'HOME'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBe('WON');
  });
  it('settles AWAY as LOST when the home team wins', () => {
    expect(determineLegOutcome(leg('m1-h2h', 'AWAY'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBe('LOST');
  });
  it('settles DRAW as WON on a draw', () => {
    expect(determineLegOutcome(leg('m1-h2h', 'DRAW'), { winner: 'DRAW', totalGoals: 2, bothScored: true })).toBe('WON');
  });
});

describe('determineLegOutcome — totals (over/under)', () => {
  it('Over 2.5 wins when total goals > 2.5', () => {
    expect(determineLegOutcome(leg('m1-totals', 'Over-2.5'), { winner: 'HOME', totalGoals: 3, bothScored: false })).toBe('WON');
  });
  it('Over 2.5 loses when total goals < 2.5', () => {
    expect(determineLegOutcome(leg('m1-totals', 'Over-2.5'), { winner: 'HOME', totalGoals: 1, bothScored: false })).toBe('LOST');
  });
  it('Under 2.5 wins when total goals < 2.5', () => {
    expect(determineLegOutcome(leg('m1-totals', 'Under-2.5'), { winner: 'AWAY', totalGoals: 1, bothScored: false })).toBe('WON');
  });
  it('a push line (exact total = line) is VOID (stake refunded)', () => {
    expect(determineLegOutcome(leg('m1-totals', 'Over-3'), { winner: 'HOME', totalGoals: 3, bothScored: true })).toBe('VOID');
  });
});

describe('determineLegOutcome — both teams to score (btts)', () => {
  it('Yes wins when both teams scored', () => {
    expect(determineLegOutcome(leg('m1-btts', 'Yes'), { winner: 'HOME', totalGoals: 2, bothScored: true })).toBe('WON');
  });
  it('No wins when only one team scored', () => {
    expect(determineLegOutcome(leg('m1-btts', 'No'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBe('WON');
  });
});

describe('determineLegOutcome — markets intentionally left pending', () => {
  it('double_chance is never auto-settled', () => {
    expect(determineLegOutcome(leg('m1-double_chance', 'HOME_DRAW'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBeNull();
  });
  it('draw_no_bet is never auto-settled', () => {
    expect(determineLegOutcome(leg('m1-draw_no_bet', 'HOME'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBeNull();
  });
  it('spreads (handicap) is never auto-settled', () => {
    expect(determineLegOutcome(leg('m1-spreads', 'Home--1.5'), { winner: 'HOME', totalGoals: 2, bothScored: false })).toBeNull();
  });
});

describe('determineLegOutcome — provider markets without canonical key (name-based)', () => {
  const nameLeg = (selection, market_name = 'Numri i Golave ne Ndeshje') => ({
    market_id: 'numri_i_golave_ne_ndeshje_m123', market_name, selection_id: selection, selection_name: selection,
  });
  const res = (goals) => ({ winner: 'DRAW', totalGoals: goals, bothScored: goals > 1 });

  it('"Lart 1.5" wins with 2 goals (the stuck-ticket case)', () => {
    expect(determineLegOutcome(nameLeg('Lart 1.5'), res(2))).toBe('WON');
  });
  it('"Lart 1.5" loses with 1 goal', () => {
    expect(determineLegOutcome(nameLeg('Lart 1.5'), res(1))).toBe('LOST');
  });
  it('"Poshtë 1.5" wins with 1 goal and loses with 2', () => {
    expect(determineLegOutcome(nameLeg('Poshtë 1.5'), res(1))).toBe('WON');
    expect(determineLegOutcome(nameLeg('Poshtë 1.5'), res(2))).toBe('LOST');
  });
  it('accepts Mbi/Nën/Over/Under and decimal commas', () => {
    expect(determineLegOutcome(nameLeg('Mbi 2,5'), res(3))).toBe('WON');
    expect(determineLegOutcome(nameLeg('Nën 2.5'), res(3))).toBe('LOST');
    expect(determineLegOutcome(nameLeg('Over-0.5'), res(1))).toBe('WON');
  });
  it('a whole-number line equal to the total is VOID', () => {
    expect(determineLegOutcome(nameLeg('Lart 2'), res(2))).toBe('VOID');
  });
  it('never settles half-time or team-specific totals from the final score', () => {
    expect(determineLegOutcome(nameLeg('Lart 0.5', 'Numri i Golave ne Pjesen e Pare'), res(3))).toBeNull();
    expect(determineLegOutcome(nameLeg('Lart 0.5', 'Numri i Golave Zakynthos'), res(3))).toBeNull();
  });
  it('unparseable selections stay pending', () => {
    expect(determineLegOutcome(nameLeg('Tek'), res(3))).toBeNull();
  });
});

describe('determineLegOutcome — every other final-score market', () => {
  const L = (market_name, selection, extra = {}) => ({
    market_id: 'x_m1', market_name, selection_id: selection, selection_name: selection,
    match_home: 'Zakynthos', match_away: 'Apollon Kalamarias', ...extra,
  });
  const R = (h, a) => ({
    winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a,
    bothScored: h > 0 && a > 0, homeScore: h, awayScore: a,
  });

  it('1X2 by name (1 / X / 2)', () => {
    expect(determineLegOutcome(L('Rezultat Final', 'X'), R(1, 1))).toBe('WON');
    expect(determineLegOutcome(L('Rezultat Final', '1'), R(1, 1))).toBe('LOST');
  });
  it('double chance 1X / X2 / 12', () => {
    expect(determineLegOutcome(L('Dopio Shans', '1X'), R(1, 1))).toBe('WON');
    expect(determineLegOutcome(L('Dopio Shans', 'X2'), R(2, 0))).toBe('LOST');
    expect(determineLegOutcome(L('Dopio Shans', '12'), R(0, 0))).toBe('LOST');
    expect(determineLegOutcome(L('Dopio Shans', '12'), R(0, 3))).toBe('WON');
  });
  it('draw no bet: draw is VOID, otherwise winner decides', () => {
    expect(determineLegOutcome(L('Home No Bet', '1'), R(1, 1))).toBe('VOID');
    expect(determineLegOutcome(L('Home No Bet', '1'), R(2, 1))).toBe('WON');
    expect(determineLegOutcome(L('Away No Bet', '2'), R(2, 1))).toBe('LOST');
  });
  it('both teams to score by Po/Jo', () => {
    expect(determineLegOutcome(L('Gol/Jogol', 'Po'), R(1, 1))).toBe('WON');
    expect(determineLegOutcome(L('Gol/Jogol', 'Jo'), R(1, 1))).toBe('LOST');
  });
  it('odd / even goals', () => {
    expect(determineLegOutcome(L('Tek/Çift', 'Tek'), R(2, 1))).toBe('WON');
    expect(determineLegOutcome(L('Tek/Çift', 'Çift'), R(2, 1))).toBe('LOST');
  });
  it('correct score', () => {
    expect(determineLegOutcome(L('Rezultati i Saktë', '2-1'), R(2, 1))).toBe('WON');
    expect(determineLegOutcome(L('Rezultati i Saktë', '1:0'), R(2, 1))).toBe('LOST');
    expect(determineLegOutcome(L('Rezultati i Saktë', 'Tjetër'), R(5, 4))).toBeNull();
  });
  it('team total goals', () => {
    expect(determineLegOutcome(L('Numri i Golave Zakynthos', 'Lart 1.5'), R(2, 0))).toBe('WON');
    expect(determineLegOutcome(L('Numri i Golave Apollon Kalamarias', 'Lart 0.5'), R(2, 0))).toBe('LOST');
  });
  it('handicap: win / loss / push (whole line) / quarter line manual', () => {
    expect(determineLegOutcome(L('Handikap', 'Zakynthos (-1.5)'), R(2, 0))).toBe('WON');
    expect(determineLegOutcome(L('Handikap', 'Zakynthos (-1.5)'), R(1, 0))).toBe('LOST');
    expect(determineLegOutcome(L('Handikap', 'Zakynthos (-1)'), R(2, 1))).toBe('VOID');
    expect(determineLegOutcome(L('Handikap', 'Apollon Kalamarias (+1)'), R(1, 1))).toBe('WON');
    expect(determineLegOutcome(L('Handikap', 'Zakynthos (-0.25)'), R(1, 0))).toBeNull();
  });
  it('never auto-settles half-time / period markets without a half-time score', () => {
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë', '1'), R(2, 0))).toBeNull();
    expect(determineLegOutcome(L('Dopio Shans Pjesa e Dytë', '1X'), R(2, 0))).toBeNull();
  });
  it('combination markets are settled part by part (see ticketOutcomes.test.js)', () => {
    expect(determineLegOutcome(L('Rezultat Final & Totali', '1 & Lart 2.5'), R(3, 0))).toBe('WON');
  });
});

describe('determineLegOutcome — first / second half markets (need the half-time score)', () => {
  const L = (market_name, selection) => ({
    market_id: 'x_m9', market_name, selection_id: selection, selection_name: selection,
    match_home: 'Zakynthos', match_away: 'Apollon Kalamarias',
  });
  // Final 3-1, half-time 1-1  =>  second half was 2-0
  const R = { winner: 'HOME', totalGoals: 4, bothScored: true, homeScore: 3, awayScore: 1, htHome: 1, htAway: 1 };

  it('first-half result uses the half-time score (draw at HT)', () => {
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë', 'X'), R)).toBe('WON');
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë', '1'), R)).toBe('LOST');
  });
  it('second-half result is final minus half-time (2-0 -> home)', () => {
    expect(determineLegOutcome(L('Rezultati Pjesa e Dytë', '1'), R)).toBe('WON');
    expect(determineLegOutcome(L('Rezultati Pjesa e Dytë', 'X'), R)).toBe('LOST');
  });
  it('goals in the first / second half', () => {
    expect(determineLegOutcome(L('Numri i Golave në Pjesën e Parë', 'Lart 1.5'), R)).toBe('WON'); // 2 goals
    expect(determineLegOutcome(L('Numri i Golave në Pjesën e Parë', 'Lart 2.5'), R)).toBe('LOST');
    expect(determineLegOutcome(L('Numri i Golave Pjesa e Dytë', 'Poshtë 2.5'), R)).toBe('WON'); // 2 goals
  });
  it('first-half BTTS, double chance and odd/even', () => {
    expect(determineLegOutcome(L('Gol/Jogol Pjesa e Parë', 'Po'), R)).toBe('WON');
    expect(determineLegOutcome(L('Gol/Jogol Pjesa e Dytë', 'Po'), R)).toBe('LOST'); // 2-0
    expect(determineLegOutcome(L('Dopio Shans - Pjesa 1', '1X'), R)).toBe('WON');
    expect(determineLegOutcome(L('Tek/Çift Pjesa e Parë', 'Çift'), R)).toBe('WON');
  });
  it('English names and "në pushim" are understood too', () => {
    expect(determineLegOutcome(L('1x2 1st Half', 'X'), R)).toBe('WON');
    expect(determineLegOutcome(L('Rezultati në Pushim', 'X'), R)).toBe('WON');
  });
  it('without a stored half-time score the leg stays pending (never guessed)', () => {
    const noHt = { ...R, htHome: undefined, htAway: undefined };
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë', 'X'), noHt)).toBeNull();
    expect(determineLegOutcome(L('Rezultati Pjesa e Dytë', '1'), noHt)).toBeNull();
  });
  it('HT/FT doubles use the half-time score; unknown half markets stay pending', () => {
    expect(determineLegOutcome(L('Pushim/Fund', 'X/1'), R)).toBe('WON'); // HT 1-1, FT 3-1
    expect(determineLegOutcome(L('Pushim/Fund', '1/1'), R)).toBe('LOST');
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë / Rezultati Final', 'X/1'), R)).toBeNull();
    expect(determineLegOutcome(L('Pjesa me Shumë Gola', 'E dyta'), R)).toBeNull();
  });
  it('a combo with a first-half part loses when that part loses', () => {
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë & Totali', '1 & Lart 0.5'), R)).toBe('LOST'); // HT was 1-1
  });
  it('inconsistent data (HT score above the final score) is never settled', () => {
    expect(determineLegOutcome(L('Rezultati Pjesa e Dytë', '1'), { ...R, homeScore: 0, awayScore: 0 })).toBeNull();
  });
});

describe('combination with a corners part', () => {
  it('settles "Rezultat Final & Totali i korneve" from the corner counters', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    const ctx = { winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0, stats: { cornersHome: 7, cornersAway: 4, cardsHome: 2, cardsAway: 3 } };
    const leg = (s) => ({ market_id: 'x', market_name: 'Rezultat Final & Totali i korneve', selection_id: s, selection_name: s });
    expect(determineLegOutcome(leg('1 & Lart 9.5'), ctx)).toBe('WON');
    expect(determineLegOutcome(leg('1 & Poshtë 9.5'), ctx)).toBe('LOST');
  });
});

describe('first team to score', () => {
  const leg = (sel, name = 'Skuadra që shënon e parë') => ({ market_id: 'x', market_name: name, selection_id: sel, selection_name: sel, match_home: 'Roma', match_away: 'Lazio' });
  const ctx = (first, last) => ({ winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0, goalOrder: first === undefined ? undefined : { first, last: last ?? first } });

  it('settles from the side that scored first', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    expect(determineLegOutcome(leg('Roma'), ctx('HOME'))).toBe('WON');
    expect(determineLegOutcome(leg('2'), ctx('HOME'))).toBe('LOST');
    expect(determineLegOutcome(leg('Lazio'), ctx('AWAY'))).toBe('WON');
  });
  it('handles a goalless match (no goal wins, a team loses)', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    expect(determineLegOutcome(leg('Asnjë'), ctx('NONE'))).toBe('WON');
    expect(determineLegOutcome(leg('1'), ctx('NONE'))).toBe('LOST');
  });
  it('stays pending when the goal order is not reliable', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    expect(determineLegOutcome(leg('Roma'), ctx(undefined))).toBeNull();
    expect(determineLegOutcome(leg('Një lojtar'), ctx('HOME'))).toBeNull();
  });
  it('works inside a combination', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    const c = { market_id: 'x', market_name: 'Skuadra që shënon e parë & Totali', selection_id: 'Roma & Lart 2.5', selection_name: 'Roma & Lart 2.5', match_home: 'Roma', match_away: 'Lazio' };
    expect(determineLegOutcome(c, ctx('HOME'))).toBe('WON');
    expect(determineLegOutcome(c, ctx('AWAY'))).toBe('LOST');
  });
});

describe('firstScorerFromEvents', () => {
  it('trusts the events only when they add up to the final score', async () => {
    const { firstScorerFromEvents: f } = await import('../server/matchSettlement.js');
    const ev = [{ team: 'Roma', created_at: 1 }, { team: 'Lazio', created_at: 2 }, { team: 'Roma', created_at: 3 }];
    expect(f(ev, 'Roma', 'Lazio', 2, 1)).toBe('HOME');
    expect(f(ev, 'Roma', 'Lazio', 3, 1)).toBeUndefined(); // a goal is missing from the log
    expect(f([], 'Roma', 'Lazio', 0, 0)).toBe('NONE');
    expect(f([{ team: 'Roma', created_at: 5 }, { team: 'Lazio', created_at: 5 }], 'Roma', 'Lazio', 1, 1)).toBeUndefined(); // tie in time
  });
});

describe('last team to score, first goal, both halves', () => {
  const L = (market, sel) => ({ market_id: 'x', market_name: market, selection_id: sel, selection_name: sel, match_home: 'Roma', match_away: 'Lazio' });
  const ctx = { winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0, goalOrder: { first: 'HOME', last: 'HOME' } };

  it('settles the last team to score from the goal order', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    const c = { ...ctx, goalOrder: { first: 'HOME', last: 'AWAY' } };
    expect(determineLegOutcome(L('Skuadra që shënon e fundit', 'Lazio'), c)).toBe('WON');
    expect(determineLegOutcome(L('Skuadra që shënon e fundit', 'Roma'), c)).toBe('LOST');
  });
  it('settles \"Goli i Parë\" only for side selections, never for a player', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    expect(determineLegOutcome(L('Goli i Parë', '1'), ctx)).toBe('WON');
    expect(determineLegOutcome(L('Goli i Parë', 'Dybala'), ctx)).toBeNull();
  });
  it('settles \"scores in both halves\" for a team selection from the half-time score', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    expect(determineLegOutcome(L('Shënon në të dyja pjesët', 'Roma'), ctx)).toBe('WON'); // 1 + 1
    expect(determineLegOutcome(L('Shënon në të dyja pjesët', 'Lazio'), ctx)).toBe('LOST'); // 0 + 1
    expect(determineLegOutcome(L('Shënon në të dyja pjesët', 'Po'), ctx)).toBeNull(); // ambiguous
    expect(determineLegOutcome(L('Shënon në të dyja pjesët', 'Roma'), { ...ctx, htHome: undefined, htAway: undefined })).toBeNull();
  });
  it('settles Po/Jo \"Shënojnë në të dyja pjesët\" only when every reading of the label agrees', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    const M = 'Shënojnë në të dyja pjesët';
    // both teams scored in both halves (1-1 at HT, 2-2 final): Po wins under every reading
    const all = { ...ctx, homeScore: 2, awayScore: 2, htHome: 1, htAway: 1 };
    expect(determineLegOutcome(L(M, 'Po'), all)).toBe('WON');
    expect(determineLegOutcome(L(M, 'Jo'), all)).toBe('LOST');
    // no goal in the second half (1-0 HT, 1-0 final): no reading can be true
    const none = { ...ctx, homeScore: 1, awayScore: 0, htHome: 1, htAway: 0 };
    expect(determineLegOutcome(L(M, 'Po'), none)).toBe('LOST');
    expect(determineLegOutcome(L(M, 'Jo'), none)).toBe('WON');
    // 0-0: no goals at all
    expect(determineLegOutcome(L(M, 'Po'), { ...ctx, homeScore: 0, awayScore: 0, htHome: 0, htAway: 0 })).toBe('LOST');
    // goals in both halves but not by both teams (2-1, HT 1-0): readings disagree -> PENDING
    expect(determineLegOutcome(L(M, 'Po'), ctx)).toBeNull();
    expect(determineLegOutcome(L(M, 'Jo'), ctx)).toBeNull();
    // no half-time score -> PENDING
    expect(determineLegOutcome(L(M, 'Po'), { ...all, htHome: undefined, htAway: undefined })).toBeNull();
  });
});

describe('first / second half corner and card markets', () => {
  const L = (market, sel) => ({ market_id: 'x', market_name: market, selection_id: sel, selection_name: sel, match_home: 'Roma', match_away: 'Lazio' });
  const base = { winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0 };
  const stats = { cornersHome: 7, cornersAway: 4, cardsHome: 3, cardsAway: 2 };
  const htStats = { cornersHome: 3, cornersAway: 2, cardsHome: 1, cardsAway: 1 };

  it('first half uses the half-time counters, second half final minus half-time', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    const c = { ...base, stats, htStats };
    expect(determineLegOutcome(L('Numri i korneve Pjesa e Parë', 'Lart 4.5'), c)).toBe('WON'); // 3+2 = 5
    expect(determineLegOutcome(L('Numri i korneve Pjesa e Parë', 'Lart 5.5'), c)).toBe('LOST');
    expect(determineLegOutcome(L('Numri i korneve Pjesa e Dytë', 'Lart 5.5'), c)).toBe('WON'); // 4+2 = 6
    expect(determineLegOutcome(L('Numri i kartonëve Pjesa e Parë', 'Nën 2.5'), c)).toBe('WON'); // 1+1 = 2
  });
  it('stays PENDING without half-time counters or when a counter is missing / inconsistent', async () => {
    const { determineLegOutcome } = await import('../server/matchSettlement.js');
    expect(determineLegOutcome(L('Numri i korneve Pjesa e Parë', 'Lart 4.5'), { ...base, stats })).toBeNull();
    expect(determineLegOutcome(L('Numri i korneve Pjesa e Parë', 'Lart 4.5'), { ...base, stats, htStats: { ...htStats, cornersAway: null } })).toBeNull();
    expect(determineLegOutcome(L('Numri i korneve Pjesa e Dytë', 'Lart 4.5'), { ...base, stats, htStats: { ...htStats, cornersHome: 9 } })).toBeNull();
  });
});

describe('corners P1+P2, goal minute, red / yellow cards', () => {
  const L = (market, sel) => ({ market_id: 'x', market_name: market, selection_id: sel, selection_name: sel, match_home: 'Roma', match_away: 'Lazio' });
  const base = { winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0 };
  let det;
  beforeAll(async () => { det = (await import('../server/matchSettlement.js')).determineLegOutcome; });

  it('"Shuma e korneve P1+P2" 5+|6+ = at least 5 in the first half AND at least 6 in the second', () => {
    const htStats = { cornersHome: 3, cornersAway: 2 }; // 5 at the whistle
    const M = 'Shuma e korneve P1+P2';
    expect(det(L(M, '5+|6+'), { ...base, stats: { cornersHome: 8, cornersAway: 3 }, htStats })).toBe('WON'); // 5 + 6
    expect(det(L(M, '5+|6+'), { ...base, stats: { cornersHome: 7, cornersAway: 3 }, htStats })).toBe('LOST'); // 5 + 5
    expect(det(L(M, '5+|6+'), { ...base, stats: { cornersHome: 8, cornersAway: 3 }, htStats: { cornersHome: 2, cornersAway: 2 } })).toBe('LOST'); // 4 + 7
    expect(det(L(M, '5+|6+'), { ...base, stats: { cornersHome: 8, cornersAway: 3 } })).toBeNull(); // no HT snapshot
    expect(det(L(M, '5+|6+'), { ...base, stats: { cornersHome: 8, cornersAway: 3 }, htStats: { cornersHome: 3, cornersAway: null } })).toBeNull();
    expect(det(L(M, 'sa|qe'), { ...base, stats: { cornersHome: 8, cornersAway: 3 }, htStats })).toBeNull();
  });

  it('"Minuta e Golit" settles from exact goal minutes only', () => {
    const M = 'Minuta e Golit';
    const c = (goalMinutes) => ({ ...base, goalMinutes });
    expect(det(L(M, '1-15'), c([4, 70]))).toBeNull(); // first yes, last no: readings differ
    expect(det(L(M, '1-15'), c([4, 9]))).toBe('WON'); // every reading agrees
    expect(det(L(M, '76-90'), c([4, 9]))).toBe('LOST');
    expect(det(L(M, '90+'), c([93]))).toBe('WON');
    expect(det(L(M, '1-15'), c([]))).toBe('LOST');
    expect(det(L(M, 'Pa gol'), c([]))).toBe('WON');
    expect(det(L(M, 'Pa gol'), c([12]))).toBe('LOST');
    expect(det(L(M, '1-15'), c(undefined))).toBeNull(); // minutes not trusted
    expect(det(L('Minuta e Golit të Parë', '1-15'), c([4, 70]))).toBe('WON');
    expect(det(L('Minuta e Golit të Fundit', '1-15'), c([4, 70]))).toBe('LOST');
    expect(det(L(M, 'Çfarëdo'), c([4]))).toBeNull();
  });

  it('red / yellow card markets use their own counters and never treat a missing value as 0', () => {
    const stats = { cardsHome: 3, cardsAway: 2, yellowHome: 2, yellowAway: 2, redHome: 1, redAway: 0 };
    expect(det(L('Karton i Kuq', 'Po'), { ...base, stats })).toBe('WON');
    expect(det(L('Karton i Kuq', 'Jo'), { ...base, stats })).toBe('LOST');
    expect(det(L('Karton i Kuq', 'Jo'), { ...base, stats: { ...stats, redHome: 0 } })).toBe('WON');
    expect(det(L('Karton i Kuq', 'Po'), { ...base, stats: { ...stats, redHome: null, redAway: null } })).toBeNull();
    expect(det(L('Numri i kartonëve të verdhë', 'Lart 3.5'), { ...base, stats })).toBe('WON'); // 2+2 = 4 yellow
  });
});
