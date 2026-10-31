import { describe, it, expect } from 'vitest';
import { isMajorResultLeague as server } from '../server/majorResults.js';
import { isMajorResultLeague as client } from '../utils/majorResults';

const yes = ['l365_england__premier_league', 'l365_italy__serie_a', 'l365_spain__la_liga', 'l365_germany__bundesliga',
  'l365_france__ligue_1', 'l365_portugal__primeira_liga', 'l365_portugal__liga_portugal',
  'l365_international__uefa_champions_league', 'l365_international__uefa_europa_league',
  'l365_international__world_cup', 'l365_international__uefa_european_championship'];
const no = ['l365_england__championship', 'l365_england__premier_league_2', 'l365_england__u21_premier_league', 'l365_italy__serie_b',
  'l365_spain__la_liga_2', 'l365_germany__2_bundesliga', 'l365_france__ligue_2', 'l365_portugal__liga_portugal_2',
  'l365_albania__superliga', 'l365_brazil__serie_a', 'l365_international__uefa_conference_league',
  'l365_international__uefa_womens_champions_league', 'l365_international__copa_libertadores', 'epl', ''];

describe('major result leagues', () => {
  for (const [name, fn] of [['server', server], ['client', client]]) {
    it(`${name}: keeps the main competitions`, () => { for (const k of yes) expect(fn(k), k).toBe(true); });
    it(`${name}: drops everything else`, () => { for (const k of no) expect(fn(k), k).toBe(false); });
  }
});
