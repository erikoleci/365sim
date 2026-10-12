import { describe, it, expect } from 'vitest';
import { buildTeamIndex, normTeam } from '../server/teamIndex.js';

const row = (o) => ({ h: 'Chelsea', a: 'Bournemouth', live_minute: null, live_minute_updated_at: null, live_home_score: null, live_away_score: null, ...o });

describe('buildTeamIndex - linking the team-name feed to ONE game id', () => {
  it('a single LIVE record maps by normalised team names', () => {
    const m = buildTeamIndex([row({ game_id: 'l365-5200421' })]);
    expect(m.get(normTeam('Chelsea') + '|' + normTeam('Bournemouth'))).toBe('5200421');
  });
  it('the same fixture under two ids resolves to the one with real live data (was "ambiguous" -> events dropped)', () => {
    const ghost = row({ game_id: 'l365-5122706', live_home_score: 0, live_away_score: 0 });
    const real = row({ game_id: 'l365-5200421', live_minute: '75:39', live_minute_updated_at: '1791646491714', live_home_score: 5, live_away_score: 1 });
    expect(buildTeamIndex([ghost, real]).get('chelsea|bournemouth')).toBe('5200421');
    expect(buildTeamIndex([real, ghost]).get('chelsea|bournemouth')).toBe('5200421');
  });
  it('a genuine tie stays ambiguous (null): one fixture is never mapped to another by guessing', () => {
    const a = row({ game_id: 'l365-1', live_minute: '10:00', live_minute_updated_at: '1' });
    const b = row({ game_id: 'l365-2', live_minute: '11:00', live_minute_updated_at: '2' });
    expect(buildTeamIndex([a, b]).get('chelsea|bournemouth')).toBeNull();
    expect(buildTeamIndex([row({ game_id: 'l365-1' }), row({ game_id: 'l365-2' })]).get('chelsea|bournemouth')).toBeNull();
  });
  it('different fixtures never collide, and home/away order matters', () => {
    const m = buildTeamIndex([row({ game_id: 'l365-1' }), row({ game_id: 'l365-2', h: 'Bournemouth', a: 'Chelsea' }), row({ game_id: 'l365-3', h: 'Ipswich Town', a: 'Fulham FC' })]);
    expect(m.get('chelsea|bournemouth')).toBe('1');
    expect(m.get('bournemouth|chelsea')).toBe('2');
    expect(m.get('ipswichtown|fulhamfc')).toBe('3');
  });
});
