// Every market + option the provider showed for ONE live match (Kyoto Sanga FC v Ratchaburi FC),
// as [marketName, options[]] entries. Odds are irrelevant for settlement and left out.
// The same market name can appear twice with different option styles (see "Sa Gola ... 2te").
const ou = (...pts) => pts.flatMap((p) => [`Lart ${p}`, `Poshte ${p}`]);
const yn = ['Yes', 'No'];
const poJo = ['Po', 'Jo'];
const trio = ['1', 'X', '2'];
const htftPairs = [];
for (const a of trio) for (const b of trio) htftPairs.push(`${a}-${b}`);
const words = ['Home', 'Draw', 'Away'];
const wordPairs = [];
for (const a of words) for (const b of words) wordPairs.push(`${a}/${b}`);
const lines = (list, withUndefined) => list.flatMap((l) => ['1', '2'].map((s) => `${s} ${l}${withUndefined ? ' (undefined)' : ''}`));
const csFT = ['1:0', '2:0', '2:1', '3:0', '3:1', '3:2', '4:0', '4:1', '4:2', '5:0', '5:1', '6:0', '0:0', '1:1', '2:2', '3:3', '0:1', '0:2', '1:2', '0:3', '1:3', '2:3', '0:4', '1:4', '2:4', '0:5', '1:5', '0:6'];
const halfCS = ['1:0', '2:0', '2:1', '0:0', '1:1', '2:2', '0:1', '0:2', '1:2'];
const euro = (n) => [`1 ${n}`, `X ${n}`, `2 ${n}`];
const cornersTotal = ['0-5', '0-6', '0-7', '0-8', '0-9', '0-10', '0-11', '0-12', '0-13', '7+', '8+', '9+', '10+', '11+', '12+', '13+', '14+', '15+', '6-8', '9-11', '12-14', '8Fiks', '9Fiks', '10Fiks', '11Fiks', '12Fiks'];
const cornersHalf = ['0-3', '4+', '0-4', '5+', '6+', '5Fiks'];
const ranges5 = ['0', '1-2', '1-3', '2-3', '4+'];
const dc3 = ['1X', '12', 'X2'];
const dcWords = ['HomeDraw', 'HomeAway', 'DrawAway'];
const dcBtts = dcWords.flatMap((d) => [`${d} / Yes`, `${d} / No`]);

export const MARKETS = [
  ['Rezultat Final', ['Kyoto Sanga FC', 'Barazim', 'Ratchaburi FC']],
  ['Dopio Shans', dc3],
  ['Rezultati Pjesës së Parë', trio],
  ['Cila Skuadër Shënon Golin e 1rë', ['1', "S'ka gol", '2']],
  ['Rezultati Pjesës së Dytë', trio],
  ['Cila Skuadër Shënon Golin e fundit', ['1', "S'ka gol", '2']],
  ['Tek/Cift', ['Tek', 'Cift']],
  ['Pritesi Tek/Cift', ['Tek', 'Cift']],
  ['Udhetuesi Tek/Cift', ['Tek', 'Cift']],
  ['Lart-Poshte/Gol-Jo Gol', ['Gol/3+', 'Gol/0-2', 'JoGol/3+', 'JoGol/0-2']],
  ['Rezultat Final & Numri i Golave në Ndeshje', trio.flatMap((s) => ['0-1', '2+', '0-2', '3+', '0-3', '4+', '0-4', '5+'].map((r) => `${s}/${r}`))],
  ['Në Cilën Pjesë do të Shënohen më Shumë Gola', ['Pjesen e 1re', 'Pjesen e 2te', 'Barazim']],
  ['Goli i Pare ne Pjese te Pare', ['None 1', '1 1', '2 1']],
  ['Tek/Cift Pjesa e 1rë', ['Tek', 'Cift']],
  ['Tek/Cift Pjesa e 2të', ['Tek', 'Cift']],
  ['Rezultat i Sakte Pjesa 1/Final', ['0-0 0-0', '0-0 1-0', '0-0 0-1', '0-0 2-0', '0-0 1-1', '0-0 0-2', '0-0 3-0', '0-0 2-1', '0-0 1-2', '0-0 0-3', '0-0 4plus', '1-0 1-0', '1-0 2-0', '1-0 1-1', '1-0 3-0', '1-0 2-1', '1-0 1-2', '1-0 4plus', '0-1 0-1', '0-1 1-1', '0-1 0-2', '0-1 2-1', '0-1 1-2', '0-1 0-3', '0-1 4plus', '2-0 2-0', '2-0 3-0', '2-0 2-1', '2-0 4plus', '1-1 1-1', '1-1 2-1', '1-1 1-2', '1-1 4plus', '0-2 0-2', '0-2 1-2', '0-2 0-3', '0-2 4plus', '3-0 3-0', '3-0 4plus', '2-1 2-1', '2-1 4plus', '1-2 1-2', '1-2 4plus', '0-3 0-3', '0-3 4plus', '4plus 4plus']],
  ['45/90', htftPairs.map((p) => p.replace('-', '/'))],
  ['45/90 & Numri i Golave në Ndeshje', htftPairs.flatMap((p) => ['2+', '0-1', '3+', '0-2', '4+', '0-3', '5+', '0-4'].map((r) => `${p}/${r}`))],
  ['45/90 & Numri i Golave në Pjesën e Parë', htftPairs.flatMap((p) => ['0', '2+', '0-1', '3+', '0-2'].map((r) => `${p}/${r}`))],
  ['Halftime/fulltime & exact goals', ['0', '1', '2', '3', '4', '5+'].flatMap((n) => wordPairs.map((w) => `${n} ${w}`))],
  ['Numri i Golave në Ndeshje', ou('0.5', '1.5', '2.5', '3.5', '4.5', '5.5')],
  ['Shuma e Saktë e Golave në Ndeshje', ['0', '1', '2', '4', '5']],
  ['Sa Gola Shënohen në Pjesën e 2të', ou('0.5', '1.5', '2.5')],
  ['Sasia e Golave Përfundimtare', ['0', '1-2', '1-3', '1-4', '1-5', '1-6', '2-3', '2-4', '2-5', '2-6', '3-4', '3-5', '3-6', '4-5', '4-6', '5-6', '7+']],
  ['Sa Gola Shënohen në Pjesën e 2të', ['0', '1-2', '1-3', '2-3', '4+']],
  ['Any team to win', ['X', '12']],
  ['Sa Gola Shënohen në Pjesën e 1rë', ou('0.5', '1.5', '2.5')],
  ['Sasia Golave në Pjesën e 1rë', ['0', '1-2', '1-3', '2-3', '4+']],
  ['Numri i Golave Pritesi', ou('0.5', '1.5', '2.5', '3.5', '4.5')],
  ['Numri i Golave Udhetuesi', ou('0.5', '1.5', '2.5')],
  ['Home clean sheet', yn], ['Away clean sheet', yn],
  ['Pritesi fiton me zero', poJo], ['Udhetuesi fiton me zero', poJo],
  ['Pritesi fiton te dy pjeset', yn], ['Udhetuesi fiton te dy pjeset', yn],
  ['Home to win either half', yn], ['Away to win either half', yn],
  ['Home highest scoring half', ['1st', '2nd', 'Equal']], ['Away highest scoring half', ['1st', '2nd', 'Equal']],
  ['Pritesi shenon ne te dy pjeset', poJo], ['Udhetuesi shenon ne te dy pjeset', poJo],
  ['Sa gola shenon Pritesi ne Pjesen e 1re', ou('0.5', '1.5', '2.5')], ['Sa gola shenon Udhetuesi ne Pjesen e 1re', ou('0.5', '1.5')],
  ['1st half - Home clean sheet', yn], ['1st half - Away clean sheet', yn],
  ['Sa gola shenon Pritesi ne Pjesen e 2te', ou('0.5', '1.5', '2.5')], ['Sa gola shenon Udhetuesi ne Pjesen e 2te', ou('0.5', '1.5')],
  ['2nd half - Home clean sheet', yn], ['2nd half - Away clean sheet', yn],
  ['Home multigoals', ranges5], ['Away multigoals', ranges5],
  ['Fiton Pritesi ose 3+', poJo], ['Fiton Pritesi ose 0-2Gola', poJo],
  ['Barazim ose 3+', poJo], ['Barazim ose 0-2 Gola', poJo],
  ['Fiton Udhetuesi ose 3+', poJo], ['Fiton Udhetuesi ose 0-2 Gola', poJo],
  ['Home or any clean sheet', yn], ['Draw or any clean sheet', yn], ['Away or any clean sheet', yn],
  ['Away to win', ['2', '1X']], ['Home to win', ['1', 'X2']],
  ['Gol/JoGol', poJo],
  ['Rezultat Final/Gol-Jo Gol', ['1/Gol', '1/JoGol', 'X/Gol', 'X/JoGol', '2/Gol', '2/JoGol']],
  ['RP1/RP2 & Gol/JoGol', ['JG/ JG', 'GG / JG', 'GG / GG', 'JG / GG']],
  ['Gol-Jo Gol në Pjesën e 1rë', poJo],
  ['1st half - 1x2 & both teams to score', ['Home / Yes', 'Home / No', 'Draw / Yes', 'Draw / No', 'Away / Yes', 'Away / No']],
  ['Gol-Jo Gol në Pjesën e 2të', poJo],
  ['2nd half - 1x2 & both teams to score', ['Home / Yes', 'Home / No', 'Draw / Yes', 'Draw / No', 'Away / Yes', 'Away / No']],
  ['Fiton Pritesi ose Gol/JoGol', poJo], ['Barazim ose Gol/JoGol', poJo], ['Fiton Udhetuesi ose Gol/JoGol', poJo],
  ['Rezultati i Sakte', csFT],
  ['Dopio Shans - Pjesa 1rë', dc3],
  ['Rezultati i Sakte i Pjeses se 1re', ['Te Tjera', ...halfCS]],
  ['Dopio Shans - Pjesa 2të', dc3],
  ['Rezultat i Sakte Pjesa - 2të', [...halfCS, 'other']],
  ['Double chance (match) & 1st half both teams score', dcBtts],
  ['Double chance (match) & 2nd half both teams score', dcBtts],
  ['1st half - double chance & both teams to score', dcBtts],
  ['2nd half - double chance & both teams to score', dcBtts],
  ['Dopio Shans & Gol/JGol', dc3.flatMap((d) => [`${d}_Gol`, `${d}_JoGol`])],
  ['Dopio Shans me Kombinime', ['1X_0-1', '12_0-1', 'X2_0-1', '1X_2+', '12_2+', '2X_2+', '1X_0-2', '12_0-2', 'X2_0-2', '1X_3+', '12_3+', 'X2_3+', '1X_0-3', '12_0-3', '2X_0-3', '1X_4+', '12_4+', 'X2_4+', '1X_0-4', '12_0-4', 'X2_0-4', '1X_5+', '12_5+', 'X2_5+']],
  ['Fitore/Fitore', ['1', '2']],
  ['Home no bet', ['X', '2']], ['Away no bet', ['1', 'X']],
  ['Handikap Europian', [...euro('0:1'), ...euro('0:2'), ...euro('1:0'), 'X 2:0', '2 2:0']],
  ['Handikap', lines(['-0.25', '-0.5', '-0.75', '-1', '-1.25', '-1.5', '-1.75', '-2', '-2.25', '-2.5', '-2.75', '-3', '0'], true)],
  ['Fitore/Fitore - Pjesa 1rë', ['1', '2']],
  ['Handikap Europian - Pjesa 1rë', [...euro('0:1'), ...euro('1:0')]],
  ['Handikap - Pjesa 1rë', lines(['-0.25', '-0.5', '-0.75', '-1', '-1.25', '-1.5', '-1.75', '0', '0.25'], false)],
  ['Fitore - Fitore Pjesa e 2të', ['1', '2']],
  ['Handikap Europian Pjesa 2-të', [...euro('0:1'), ...euro('1:0')]],
  ['Handikap Aziatik Pjesa 2-të', lines(['-0.25', '-0.5', '-0.75', '-1', '-1.25', '-1.5', '-1.75', '0', '0.25'], false)],
  ['Lart/Poshtë Gola Aziatikë', ou('1', '1.25', '1.75', '2', '2.25', '2.75', '3', '3.25', '3.75', '4', '4.25', '4.75', '5', '5.25', '5.75')],
  ['Lart/Poshte Gola Aziatik ne Pjesen 2', ou('0.75', '1', '1.25', '1.75', '2', '2.25', '2.75', '3')],
  ['Lart/Poshte Gola Aziatik ne Pjesen 1', ou('0.75', '1', '1.25', '1.75', '2', '2.25')],
  ['Shuma total e korneve', cornersTotal],
  ['Shuma total e korneve ne P1', cornersHalf],
  ['Shuma total e korneve ne P2', cornersHalf],
  ['Shuma e korneve P1+P2', ['4+|4+', '4+|5+', '4+|6+', '5+|4+', '5+|5+', '5+|6+', '6+|4+', '6+|5+', '6+|6+']],
];

export const HOME = 'Kyoto Sanga FC';
export const AWAY = 'Ratchaburi FC';
