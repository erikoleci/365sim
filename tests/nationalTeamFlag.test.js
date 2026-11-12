import { describe, it, expect } from 'vitest';
import { nationalTeamFlag } from '../utils/nationalTeamFlag.ts';

describe('national team flags', () => {
  it('maps the names from the Nations League list', () => {
    expect(nationalTeamFlag('Armenia')).toBe('🇦🇲');
    expect(nationalTeamFlag('Cyprus')).toBe('🇨🇾');
    expect(nationalTeamFlag('Turkiye')).toBe('🇹🇷');
    expect(nationalTeamFlag('Belgium')).toBe('🇧🇪');
    expect(nationalTeamFlag('Italy')).toBe('🇮🇹');
    expect(nationalTeamFlag('Czechia')).toBe('🇨🇿');
    expect(nationalTeamFlag('Croatia')).toBe('🇭🇷');
    expect(nationalTeamFlag('Albania')).toBe('🇦🇱');
    expect(nationalTeamFlag('Bosnia and Herzegovina')).toBe('🇧🇦');
    expect(nationalTeamFlag('North Macedonia')).toBe('🇲🇰');
    expect(nationalTeamFlag('Ivory Coast')).toBe('🇨🇮');
    expect(nationalTeamFlag('USA')).toBe('🇺🇸');
  });
  it('England / Scotland / Wales get their own flags', () => {
    expect(nationalTeamFlag('England')?.codePointAt(0)).toBe(0x1f3f4);
    expect(nationalTeamFlag('Scotland')).not.toBe(nationalTeamFlag('England'));
    expect(nationalTeamFlag('Wales')?.codePointAt(0)).toBe(0x1f3f4);
  });
  it('youth and women teams keep the country flag', () => {
    expect(nationalTeamFlag('Spain U21')).toBe('🇪🇸');
    expect(nationalTeamFlag('Italy Women')).toBe('🇮🇹');
  });
  it('clubs and unknown names get no flag', () => {
    expect(nationalTeamFlag('Arsenal')).toBeNull();
    expect(nationalTeamFlag('Khonkaen Mordindang FC')).toBeNull();
    expect(nationalTeamFlag('')).toBeNull();
    expect(nationalTeamFlag(null)).toBeNull();
  });
});
