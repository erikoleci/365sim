import { describe, it, expect } from 'vitest';
import { endTwinVerdict } from '../server/liveTwin.js';

const cat = { id: 'l365-5244498', home_team: 'Manchester United', away_team: 'Aston Villa', league: 'l365_england__premier_league', start_time: '2026-11-08T16:30:00.000Z' };
const twin = (o = {}) => ({ id: 'l365-5294923', home_team: 'Man Utd', away_team: 'Aston Villa', league: 'l365_england__premier_league', start_time: '2026-11-08T16:30:00.000Z', status: 'LIVE', result_home: null, result_away: null, ...o });

describe('endTwinVerdict (ticket #120: catalogue record froze at 2-4, match ended 4-4)', () => {
  it('no twin -> close from its own score as before', () => {
    expect(endTwinVerdict(cat, [])).toEqual({ action: 'own' });
    expect(endTwinVerdict(cat, [twin({ league: 'l365_england__championship', home_team: 'Leeds', away_team: 'Derby' })])).toEqual({ action: 'own' });
  });
  it('twin still playing -> wait', () => {
    expect(endTwinVerdict(cat, [twin()])).toEqual({ action: 'wait' });
  });
  it('twin finished without a score -> wait', () => {
    expect(endTwinVerdict(cat, [twin({ status: 'FINISHED' })])).toEqual({ action: 'wait' });
  });
  it('twin finished 4-4 -> settle on the twin score, not the frozen 2-4', () => {
    expect(endTwinVerdict(cat, [twin({ status: 'FINISHED', result_home: 4, result_away: 4 })])).toMatchObject({ action: 'twin', home: 4, away: 4, twinId: 'l365-5294923' });
  });
  it('aligns the sides when the twin lists the clubs the other way round', () => {
    const t = twin({ status: 'FINISHED', home_team: 'Aston Villa', away_team: 'Man Utd', result_home: 1, result_away: 3 });
    expect(endTwinVerdict(cat, [t])).toMatchObject({ action: 'twin', home: 3, away: 1 });
  });
  it('two candidates -> wait instead of guessing', () => {
    const a = twin({ status: 'FINISHED', result_home: 4, result_away: 4 });
    expect(endTwinVerdict(cat, [a, { ...a, id: 'x2' }])).toEqual({ action: 'wait' });
  });
});
