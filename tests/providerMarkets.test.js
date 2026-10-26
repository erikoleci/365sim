import { describe, it, expect } from 'vitest';
import { parseProviderMarket, providerOutcome, goalTimelineFromRows, teamGoalsOption } from '../server/providerMarkets.js';
import { determineLegOutcome } from '../server/matchSettlement.js';
import { getBetBlockReason, describeMarket, describeBlockReason } from '../server/marketRules.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const spec = (n) => parseProviderMarket(norm(n));

describe('parsing the provider names', () => {
  it('recognises the markets seen on the provider site', () => {
    expect(spec('Nr-Gola Pritesi')).toEqual({ type: 'team_goals', side: 'HOME' });
    expect(spec('Nr-Gola Udhetuesi')).toEqual({ type: 'team_goals', side: 'AWAY' });
    expect(spec('Shenon Pritesi ne P2')).toEqual({ type: 'team_scores', side: 'HOME', half: 2 });
    expect(spec('Shenon Udhetuesi ne P1/P2')).toEqual({ type: 'team_scores', side: 'AWAY', half: 'both' });
    expect(spec('Gol / Jo Gol Ne P2')).toEqual({ type: 'btts_half', half: 2 });
    expect(spec('Rezultat Final/Gol-Gol')).toEqual({ type: 'result_btts' });
    expect(spec('Goli i Dyte Shenohet perpara min. 60:00')).toEqual({ type: 'goal_before', k: 2, side: null, minute: 60 });
    expect(spec('Goli i Pare i Pritesit perpara min. 70:00')).toEqual({ type: 'goal_before', k: 1, side: 'HOME', minute: 70 });
    expect(spec('Goli i Dyte i Udhetuesit perpara min. 60:00')).toEqual({ type: 'goal_before', k: 2, side: 'AWAY', minute: 60 });
    expect(spec('RF-60Min')).toEqual({ type: 'rf_at', minute: 60 });
    expect(spec('Rezultati Final Gola 3+')).toEqual({ type: 'result_goals' });
    expect(spec('Menyra e Golit te 2-te')).toBeNull();
    expect(spec('Goditje Total Pritesi - 11.5')).toBeNull();
  });
  it('reads the Nr-Gola options', () => {
    expect(teamGoalsOption('0 gola')).toEqual({ n: 0, plus: false });
    expect(teamGoalsOption('1 gol')).toEqual({ n: 1, plus: false });
    expect(teamGoalsOption('3+ gola')).toEqual({ n: 3, plus: true });
    expect(teamGoalsOption('po')).toBeNull();
  });
});

describe('settlement', () => {
  const ctx = { homeScore: 2, awayScore: 1, htHome: 1, htAway: 0 };
  it('Nr-Gola, scores in a half, result & both teams score', () => {
    expect(providerOutcome(spec('Nr-Gola Pritesi'), '2 gola', ctx)).toBe('WON');
    expect(providerOutcome(spec('Nr-Gola Pritesi'), '3+ gola', ctx)).toBe('LOST');
    expect(providerOutcome(spec('Nr-Gola Udhetuesi'), '1 gol', ctx)).toBe('WON');
    expect(providerOutcome(spec('Shenon Pritesi ne P2'), 'po', ctx)).toBe('WON');   // 1 goal in P2
    expect(providerOutcome(spec('Shenon Udhetuesi ne P2'), 'po', ctx)).toBe('WON'); // 1 goal in P2
    expect(providerOutcome(spec('Shenon Udhetuesi ne P1/P2'), 'po', ctx)).toBe('LOST'); // none in P1
    expect(providerOutcome(spec('Shenon Pritesi ne P1/P2'), 'po', ctx)).toBe('WON');
    expect(providerOutcome(spec('Rezultat Final/Gol-Gol'), '1|g', ctx)).toBe('WON');
    expect(providerOutcome(spec('Rezultat Final/Gol-Gol'), '1|jg', ctx)).toBe('LOST');
    expect(providerOutcome(spec('Rezultat Final/Gol-Gol'), '2|g', ctx)).toBe('LOST');
    expect(providerOutcome(spec('Gol / Jo Gol Ne P2'), '1', ctx)).toBe('WON'); // P2 ends 1-1: both scored
    expect(providerOutcome(spec('Gol / Jo Gol Ne P2'), '2', ctx)).toBe('LOST');
  });
  it('needs the half-time score and never guesses', () => {
    const noHt = { homeScore: 2, awayScore: 1 };
    expect(providerOutcome(spec('Shenon Pritesi ne P2'), 'po', noHt)).toBeNull();
    expect(providerOutcome(spec('Gol / Jo Gol Ne P2'), '1', noHt)).toBeNull();
    expect(providerOutcome(spec('Nr-Gola Pritesi'), 'nonsense', ctx)).toBeNull();
  });
  it('goal before minute N and RF-N come from the goal timeline', () => {
    const tl = [{ minute: 12, side: 'HOME' }, { minute: 58, side: 'AWAY' }, { minute: 75, side: 'HOME' }];
    const c = { ...ctx, goalTimeline: tl };
    expect(providerOutcome(spec('Goli i Dyte Shenohet perpara min. 60:00'), 'po', c)).toBe('WON');   // 2nd goal at 58
    expect(providerOutcome(spec('Goli i Dyte Shenohet perpara min. 50:00'), 'po', c)).toBe('LOST');
    expect(providerOutcome(spec('Goli i Dyte i Udhetuesit perpara min. 60:00'), 'po', c)).toBe('LOST'); // away has only 1 goal
    expect(providerOutcome(spec('Goli i Pare i Pritesit perpara min. 60:00'), 'po', c)).toBe('WON');
    expect(providerOutcome(spec('RF-60Min'), '1', c)).toBe('LOST');  // 1-1 at 60:00
    expect(providerOutcome(spec('RF-60Min'), 'x', c)).toBe('WON');
    expect(providerOutcome(spec('RF-70Min'), 'x', c)).toBe('WON');
    expect(providerOutcome(spec('RF-90Min'), '1', c)).toBe('WON');
    expect(providerOutcome(spec('RF-60Min'), 'x', ctx)).toBeNull(); // no trusted timeline
  });
  it('builds the timeline only when every goal is logged with an exact minute', () => {
    const rows = [{ team: 'Roma', minute: 12, minute_exact: true }, { team: 'Lazio', minute: 58, minute_exact: true }];
    expect(goalTimelineFromRows(rows, 'Roma', 'Lazio', 1, 1)).toEqual([{ minute: 12, side: 'HOME' }, { minute: 58, side: 'AWAY' }]);
    expect(goalTimelineFromRows(rows, 'Roma', 'Lazio', 2, 1)).toBeUndefined(); // a goal missing
    expect(goalTimelineFromRows([{ ...rows[0], minute_exact: false }, rows[1]], 'Roma', 'Lazio', 1, 1)).toBeUndefined();
    expect(goalTimelineFromRows([], 'Roma', 'Lazio', 0, 0)).toEqual([]);
  });
  it('flows through determineLegOutcome, incl. the 1 = Gol / 2 = Jo Gol labels', () => {
    const leg = (market, sel) => ({ market_id: 'x', market_name: market, selection_id: sel, selection_name: sel, match_home: 'Roma', match_away: 'Lazio' });
    const R = { winner: 'HOME', totalGoals: 3, bothScored: true, homeScore: 2, awayScore: 1, htHome: 1, htAway: 0 };
    expect(determineLegOutcome(leg('Nr-Gola Pritesi', '2 Gola'), R)).toBe('WON');
    expect(determineLegOutcome(leg('Gol Jo Gol Live', '1'), R)).toBe('WON');
    expect(determineLegOutcome(leg('Gol Jo Gol Live', '2'), R)).toBe('LOST');
    expect(determineLegOutcome(leg('Gol / Jo Gol Ne P2', '1'), R)).toBe('WON'); // P2: 1-1
    expect(determineLegOutcome(leg('Fitore / Fitore', '1'), R)).toBe('WON');
    expect(determineLegOutcome(leg('DopioShans Live', '1X'), R)).toBe('WON');
    expect(determineLegOutcome(leg('Rezultati Sakte Live', '2-1'), R)).toBe('WON');
  });
});

describe('in play', () => {
  const row = (extra = {}) => ({ home_team: 'Udinese', away_team: 'AC Milan', status: 'LIVE', live_status: '2H',
    start_time: new Date(Date.now() - 71 * 60000).toISOString(), live_minute: '56:12', live_home_score: 1, live_away_score: 0, ht_home: 1, ht_away: 0, ...extra });
  const g = (n, sel, r = row()) => getBetBlockReason(r, { id: 'm', name: n }, { id: sel, name: sel });
  it('Nr-Gola closes once the option is fixed', () => {
    expect(g('Nr-Gola Pritesi', '0 Gola')).toBe('OUTCOME_DECIDED');
    expect(g('Nr-Gola Pritesi', '1 Gol')).toBeNull();
    expect(g('Nr-Gola Pritesi', '3+ Gola')).toBeNull();
    expect(g('Nr-Gola Udhetuesi', '0 Gola')).toBeNull();
  });
  it('scoring in P2 / both halves', () => {
    expect(g('Shenon Pritesi ne P2', 'Po')).toBeNull();
    expect(g('Shenon Pritesi ne P2', 'Po', row({ live_home_score: 2 }))).toBe('OUTCOME_DECIDED');
    expect(g('Shenon Udhetuesi ne P1/P2', 'Po')).toBe('OUTCOME_DECIDED'); // no goal in P1: cannot score in both
    expect(g('Shenon Pritesi ne P1/P2', 'Po')).toBeNull();
    expect(g('Shenon Pritesi ne P2', 'Po', row({ ht_home: null, ht_away: null }))).toBe('NOT_VERIFIABLE_LIVE');
  });
  it('goal before minute N and RF-N close 90 s before the cut-off, and once the goal is in', () => {
    expect(g('Goli i Dyte Shenohet perpara min. 60:00', 'Po')).toBeNull();
    expect(g('Goli i Dyte Shenohet perpara min. 60:00', 'Po', row({ live_minute: '58:45' }))).toBe('WINDOW_CLOSED');
    expect(g('Goli i Dyte Shenohet perpara min. 60:00', 'Po', row({ live_home_score: 1, live_away_score: 1 }))).toBe('OUTCOME_DECIDED');
    expect(g('RF-60Min', '1')).toBeNull();
    expect(g('RF-60Min', '1', row({ live_minute: '59:10' }))).toBe('WINDOW_CLOSED');
    expect(g('RF-70Min', '1', row({ live_minute: '59:10' }))).toBeNull();
    expect(g('RF-60Min', '1', row({ live_minute: null }))).toBe('NOT_VERIFIABLE_LIVE');
    expect(describeBlockReason('WINDOW_CLOSED')).toMatch(/time window/);
  });
  it('result & both teams score: JG closes once both scored; the others stay open', () => {
    expect(g('Rezultat Final/Gol-Gol', '1|JG')).toBeNull();
    expect(g('Rezultat Final/Gol-Gol', '1|JG', row({ live_away_score: 1 }))).toBe('OUTCOME_DECIDED');
    expect(g('Rezultat Final/Gol-Gol', '2|G', row({ live_away_score: 1 }))).toBeNull();
  });
  it('the aliases are covered by a settlement rule', () => {
    for (const n of ['DopioShans Live', 'Gol Jo Gol Live', 'Rezultati Sakte Live', 'Fitore / Fitore', 'Gol / Jo Gol Ne P2', 'RF-60Min']) {
      expect(describeMarket('x', n).autoSettles).toBe(true);
    }
    expect(describeMarket('x', 'Menyra e Golit te 2-te').autoSettles).toBe(false);
  });
});
