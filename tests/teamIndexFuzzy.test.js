import { describe, it, expect } from 'vitest';
import { resolveTeamsFuzzy } from '../server/teamIndex.js';

const row = (id, h, a, extra = {}) => ({ game_id: 'l365-' + id, h, a, ...extra });

describe('resolveTeamsFuzzy', () => {
  it('finds our record when the live feed writes a club differently', () => {
    const rows = [row(1, 'HB Koege', 'AGF Aarhus'), row(2, 'Torino', 'Lecce')];
    expect(resolveTeamsFuzzy(rows, 'HB Køge', 'AGF Aarhus')).toBe('1');
    expect(resolveTeamsFuzzy(rows, 'Man City', 'Nott Forest')).toBeNull();
  });
  it('needs BOTH clubs to fit, so one shared club never maps one fixture onto another', () => {
    const rows = [row(1, 'Nottingham Forest', 'Manchester City')];
    expect(resolveTeamsFuzzy(rows, 'Nottingham Forest', 'Arsenal FC')).toBeNull();
  });
  it('keeps women / youth sides apart from the senior side', () => {
    const rows = [row(1, 'Chelsea FC', 'Manchester City')];
    expect(resolveTeamsFuzzy(rows, 'Chelsea FC W', 'Manchester City W')).toBeNull();
  });
  it('picks the record with real live data when a fixture sits under two ids, and stays unresolved on a tie', () => {
    const live = { live_minute: '30:00', live_minute_updated_at: 1, live_home_score: 0, live_away_score: 0 };
    expect(resolveTeamsFuzzy([row(1, 'CPD Y Rhyl 1879', 'Holyhead Hotspur'), row(2, 'CPD Y Rhyl 1879', 'Holyhead Hotspur', live)], 'CPD Y Rhyl 1879', 'Holyhead Hotspur')).toBe('2');
    expect(resolveTeamsFuzzy([row(1, 'CPD Y Rhyl 1879', 'Holyhead Hotspur'), row(2, 'CPD Y Rhyl 1879', 'Holyhead Hotspur')], 'CPD Y Rhyl 1879', 'Holyhead Hotspur')).toBeNull();
  });
});
