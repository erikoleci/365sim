import { describe, it, expect } from 'vitest';
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
  it('never auto-settles half-time, period or combo markets', () => {
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë', '1'), R(2, 0))).toBeNull();
    expect(determineLegOutcome(L('Dopio Shans Pjesa e Dytë', '1X'), R(2, 0))).toBeNull();
    expect(determineLegOutcome(L('Rezultat Final & Totali', '1 & Lart 2.5'), R(3, 0))).toBeNull();
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
  it('HT/FT doubles, combos and unknown half markets stay pending', () => {
    expect(determineLegOutcome(L('Pushim/Fund', 'X/1'), R)).toBeNull();
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë / Rezultati Final', 'X/1'), R)).toBeNull();
    expect(determineLegOutcome(L('Pjesa me Shumë Gola', 'E dyta'), R)).toBeNull();
    expect(determineLegOutcome(L('Rezultati Pjesa e Parë & Totali', '1 & Lart 0.5'), R)).toBeNull();
  });
  it('inconsistent data (HT score above the final score) is never settled', () => {
    expect(determineLegOutcome(L('Rezultati Pjesa e Dytë', '1'), { ...R, homeScore: 0, awayScore: 0 })).toBeNull();
  });
});
