import { describe, it, expect } from 'vitest';
import { evaluateMarket } from '../server/marketRules.js';
import { MARKETS, HOME, AWAY } from './fixtures/kyotoMarkets.js';

const leg = (market, option) => ({
  market_id: 'mkt_m1', market_name: market, selection_id: option, selection_name: option,
  match_home: HOME, match_away: AWAY,
});
const run = (market, option, ctx) => evaluateMarket(leg(market, option), ctx);

// Facts for a match that ended 3-1 (half-time 1-0, away scored 2nd-half consolation)
const C31 = { home: 3, away: 1, htHome: 1, htAway: 0, firstGoal: 'HOME', lastGoal: 'AWAY', cornersTotal: 11, cornersH1: 5 };
const C00 = { home: 0, away: 0, htHome: 0, htAway: 0, cornersTotal: 8, cornersH1: 3 };
const C12 = { home: 1, away: 2, htHome: 1, htAway: 1, firstGoal: 'HOME', lastGoal: 'AWAY', cornersTotal: 9, cornersH1: 4 };

describe('every market of the live sample has a rule for every option', () => {
  for (const [name, ctx] of [['3-1', C31], ['0-0', C00], ['1-2', C12]]) {
    it('decides every option when the match ends ' + name, () => {
      const undecided = [];
      let count = 0;
      for (const [market, options] of MARKETS) {
        for (const option of options) {
          count++;
          if (run(market, option, ctx) === null) undecided.push(market + ' -> ' + option);
        }
      }
      expect(count).toBeGreaterThan(700);
      expect(undecided).toEqual([]);
    });
  }
});

// Markets whose options are mutually exclusive AND exhaustive: exactly one must win.
const PARTITIONS = [
  'Rezultat Final', 'Rezultati Pjesës së Parë', 'Rezultati Pjesës së Dytë', 'Cila Skuadër Shënon Golin e 1rë',
  'Cila Skuadër Shënon Golin e fundit', 'Tek/Cift', 'Pritesi Tek/Cift', 'Udhetuesi Tek/Cift', 'Lart-Poshte/Gol-Jo Gol',
  'Në Cilën Pjesë do të Shënohen më Shumë Gola', 'Goli i Pare ne Pjese te Pare', 'Tek/Cift Pjesa e 1rë', 'Tek/Cift Pjesa e 2të',
  '45/90', 'Home clean sheet', 'Away clean sheet', 'Pritesi fiton me zero', 'Udhetuesi fiton me zero',
  'Pritesi fiton te dy pjeset', 'Udhetuesi fiton te dy pjeset', 'Home to win either half', 'Away to win either half',
  'Home highest scoring half', 'Away highest scoring half', 'Pritesi shenon ne te dy pjeset', 'Udhetuesi shenon ne te dy pjeset',
  '1st half - Home clean sheet', '1st half - Away clean sheet', '2nd half - Home clean sheet', '2nd half - Away clean sheet',
  'Gol/JoGol', 'Rezultat Final/Gol-Jo Gol', 'RP1/RP2 & Gol/JoGol', 'Gol-Jo Gol në Pjesën e 1rë', 'Gol-Jo Gol në Pjesën e 2të',
  '1st half - 1x2 & both teams to score', '2nd half - 1x2 & both teams to score', 'Rezultati i Sakte i Pjeses se 1re',
  'Rezultat i Sakte Pjesa - 2të', 'Any team to win', 'Away to win', 'Home to win',
  'Fitore/Fitore', 'Home no bet', 'Away no bet',
];
describe('mutually exclusive markets: exactly one option wins', () => {
  for (const [mName, ctx] of [['3-1', C31], ['0-0', C00], ['1-2', C12]]) {
    for (const market of PARTITIONS) {
      it(market + ' @ ' + mName, () => {
        const options = MARKETS.find(([n]) => n === market)[1];
        const outcomes = options.map((o) => run(market, o, ctx));
        const wins = outcomes.filter((x) => x === 'WON').length;
        const voids = outcomes.filter((x) => x === 'VOID').length;
        // draw-no-bet style markets refund instead of winning on a draw
        expect(wins + voids).toBeGreaterThanOrEqual(1);
        if (!voids) expect(wins).toBe(1);
        if (voids) expect(wins).toBe(0);
      });
    }
  }
});

describe('spot checks (3-1, half-time 1-0)', () => {
  const W = (m, o, c = C31) => run(m, o, c);
  it('1X2 by team name, draw word, half and second half', () => {
    expect(W('Rezultat Final', HOME)).toBe('WON');
    expect(W('Rezultat Final', 'Barazim')).toBe('LOST');
    expect(W('Rezultati Pjesës së Parë', '1')).toBe('WON');
    expect(W('Rezultati Pjesës së Dytë', '1')).toBe('WON'); // 2nd half 2-1
  });
  it('handicaps incl. quarter lines', () => {
    expect(W('Handikap', '1 -1.5 (undefined)')).toBe('WON');   // 3-1 = margin 2
    expect(W('Handikap', '1 -2 (undefined)')).toBe('VOID');    // exactly 2 -> push
    expect(W('Handikap', '1 -2.25 (undefined)')).toBe('HALF_LOST');
    expect(W('Handikap', '1 -1.75 (undefined)')).toBe('HALF_WON');
    expect(W('Handikap', '2 -2 (undefined)')).toBe('VOID');
    expect(W('Handikap', '2 -1.5 (undefined)')).toBe('LOST');
    expect(W('Handikap Europian', '1 0:1')).toBe('WON');       // 3-2
    expect(W('Handikap Europian', 'X 0:2')).toBe('WON');        // 3-3
    expect(W('Handikap Europian', 'X 2:0')).toBe('LOST');
  });
  it('Asian totals', () => {
    expect(W('Lart/Poshtë Gola Aziatikë', 'Lart 4')).toBe('VOID');
    expect(W('Lart/Poshtë Gola Aziatikë', 'Lart 4.25')).toBe('HALF_LOST');
    expect(W('Lart/Poshtë Gola Aziatikë', 'Poshte 4.25')).toBe('HALF_WON');
    expect(W('Lart/Poshtë Gola Aziatikë', 'Lart 3.75')).toBe('HALF_WON');
    expect(W('Lart/Poshtë Gola Aziatikë', 'Lart 2.25')).toBe('WON');
  });
  it('combos', () => {
    expect(W('Rezultat Final & Numri i Golave në Ndeshje', '1/3+')).toBe('WON');
    expect(W('Rezultat Final & Numri i Golave në Ndeshje', '1/0-3')).toBe('LOST');
    expect(W('45/90 & Numri i Golave në Ndeshje', '1-1/4+')).toBe('WON');
    expect(W('45/90 & Numri i Golave në Pjesën e Parë', '1-1/0-1')).toBe('WON');
    expect(W('Halftime/fulltime & exact goals', '4 Home/Home')).toBe('WON');
    expect(W('Rezultat i Sakte Pjesa 1/Final', '1-0 4plus')).toBe('WON');
    expect(W('Rezultat i Sakte Pjesa 1/Final', '1-0 3-1')).toBe('WON');
    expect(W('Rezultat i Sakte Pjesa 1/Final', '1-0 2-1')).toBe('LOST');
    expect(W('RP1/RP2 & Gol/JoGol', 'JG / GG')).toBe('WON');   // HT 1-0 no btts, 2nd half 2-1 btts
    expect(W('Dopio Shans me Kombinime', '2X_2+')).toBe('LOST');
    expect(W('Dopio Shans me Kombinime', '1X_4+')).toBe('WON');
    expect(W('Double chance (match) & 1st half both teams score', 'HomeDraw / No')).toBe('WON');
    expect(W('1st half - double chance & both teams to score', 'HomeDraw / Yes')).toBe('LOST');
    expect(W('Lart-Poshte/Gol-Jo Gol', 'Gol/3+')).toBe('WON');
  });
  it('team / half markets', () => {
    expect(W('Pritesi fiton te dy pjeset', 'Yes')).toBe('WON');
    expect(W('Udhetuesi shenon ne te dy pjeset', 'Po')).toBe('LOST');
    expect(W('Home multigoals', '2-3')).toBe('WON');
    expect(W('Away multigoals', '1-2')).toBe('WON');
    expect(W('Numri i Golave Pritesi', 'Lart 2.5')).toBe('WON');
    expect(W('Sa gola shenon Udhetuesi ne Pjesen e 2te', 'Lart 0.5')).toBe('WON');
    expect(W('Fiton Udhetuesi ose 3+', 'Po')).toBe('WON');          // total 4
    expect(W('Fiton Pritesi ose 0-2Gola', 'Po')).toBe('WON');       // home won
    expect(W('Barazim ose 0-2 Gola', 'Jo')).toBe('WON');            // no draw, 4 goals
    expect(W('Home or any clean sheet', 'Yes')).toBe('WON');
    expect(W('Away or any clean sheet', 'Yes')).toBe('LOST');       // away lost, nobody kept a clean sheet
  });
  it('first / last goal and corners', () => {
    expect(W('Cila Skuadër Shënon Golin e 1rë', '1')).toBe('WON');
    expect(W('Cila Skuadër Shënon Golin e fundit', '2')).toBe('WON');
    expect(W('Goli i Pare ne Pjese te Pare', '1 1')).toBe('WON');
    expect(W('Shuma total e korneve', '9-11')).toBe('WON');
    expect(W('Shuma total e korneve ne P1', '5Fiks')).toBe('WON');
    expect(W('Shuma total e korneve ne P2', '4+')).toBe('WON');       // 6 corners
    expect(W('Shuma e korneve P1+P2', '5+|6+')).toBe('WON');
  });
  it('over/under: "Lart 1.5" means 2 or more (goals and corners alike)', () => {
    const c = { home: 1, away: 0, htHome: 0, htAway: 0, cornersTotal: 2, cornersH1: 1 };
    expect(run('Numri i Golave në Ndeshje', 'Lart 1.5', c)).toBe('LOST');   // 1 goal
    expect(run('Numri i Golave në Ndeshje', 'Poshte 1.5', c)).toBe('WON');
    expect(run('Numri i Golave në Ndeshje', 'Lart 1.5', { ...c, home: 1, away: 1 })).toBe('WON'); // 2 goals
    expect(run('Lart/Poshte Korne', 'Lart 1.5', c)).toBe('WON');            // 2 corners
    expect(run('Lart/Poshte Korne', 'Lart 2', c)).toBe('VOID');             // exactly 2 = push
    expect(run('Lart/Poshte Korne ne P1', 'Lart 1.5', c)).toBe('LOST');     // 1 corner in 1st half
  });
  it('0-0: no-goal answers and push', () => {
    expect(W('Cila Skuadër Shënon Golin e 1rë', "S'ka gol", C00)).toBe('WON');
    expect(W('Goli i Pare ne Pjese te Pare', 'None 1', C00)).toBe('WON');
    expect(W('Rezultati i Sakte i Pjeses se 1re', '0:0', C00)).toBe('WON');
    expect(W('Fitore/Fitore', '1', C00)).toBe('VOID');
    expect(W('Home no bet', 'X', C00)).toBe('WON');
  });
});

describe('missing facts never produce a guess', () => {
  const noHt = { home: 2, away: 0 };
  it('half markets need the half-time score', () => {
    expect(run('Rezultati Pjesës së Parë', '1', noHt)).toBeNull();
    expect(run('Handikap - Pjesa 1rë', '1 -0.5', noHt)).toBeNull();
    expect(run('45/90', '1/1', noHt)).toBeNull();
  });
  it('scorer order and corners need their events', () => {
    expect(run('Cila Skuadër Shënon Golin e 1rë', '1', { ...noHt, htHome: 1, htAway: 0 })).toBeNull();
    expect(run('Shuma total e korneve', '7+', noHt)).toBeNull();
    expect(run('Shuma total e korneve ne P1', '4+', { ...noHt, cornersTotal: 9 })).toBeNull();
  });
  it('full-time markets still settle without half-time data', () => {
    expect(run('Rezultat Final', HOME, noHt)).toBe('WON');
    expect(run('Gol/JoGol', 'Jo', noHt)).toBe('WON');
  });
  it('unknown markets stay pending', () => {
    expect(run('Some Brand New Market', 'X', C31)).toBeNull();
  });
});
