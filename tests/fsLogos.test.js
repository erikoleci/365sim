import { describe, it, expect, beforeEach } from 'vitest';
import { harvestLogos, getFsLogoMap, validLogoUrl, __resetFsLogosForTests } from '../server/fsLogos.js';
import { parseMatchList } from '../server/flashscoreMap.js';

const U = (n) => `https://static.flashscore.com/res/image/data/${n}.png`;
beforeEach(() => __resetFsLogosForTests());

describe('Flashscore crests', () => {
  it('accepts only https pictures from flashscore.com', () => {
    expect(validLogoUrl(U('abc-123'))).toBe(true);
    expect(validLogoUrl('http://static.flashscore.com/a.png')).toBe(false);
    expect(validLogoUrl('https://evil.example.com/a.png')).toBe(false);
    expect(validLogoUrl('https://static.flashscore.com.evil.com/a.png')).toBe(false);
    expect(validLogoUrl('javascript:alert(1)')).toBe(false);
    expect(validLogoUrl(null)).toBe(false);
  });
  it('writes only new addresses, keyed by OUR team names', async () => {
    const calls = [];
    const pool = { query: async (...a) => { calls.push(a); return { rows: [] }; } };
    const pairs = [{ home: 'Manchester United FC', away: 'Arsenal', homeLogo: U('a'), awayLogo: U('b') }];
    expect(await harvestLogos(pool, pairs)).toBe(2);
    expect(calls[0][1][0]).toEqual(['manchester united', 'arsenal']);
    expect(await harvestLogos(pool, pairs)).toBe(0); // same again: no write
    expect(await harvestLogos(pool, [{ home: 'Arsenal', away: 'X', homeLogo: U('b2'), awayLogo: 'https://bad.com/x.png' }])).toBe(1); // changed crest, bad one dropped
  });
  it('a database error never throws', async () => {
    expect(await harvestLogos({ query: async () => { throw new Error('down'); } }, [{ home: 'A B', away: 'C D', homeLogo: U('z') }])).toBe(0);
  });
  it('the map for the browser is cached and drops invalid rows', async () => {
    let n = 0;
    const pool = { query: async () => { n++; return { rows: [{ team_key: 'arsenal', url: U('b') }, { team_key: 'bad', url: 'https://x.com/a.png' }] }; } };
    const a = await getFsLogoMap(pool, 1000);
    expect(a.logos).toEqual({ arsenal: U('b') });
    await getFsLogoMap(pool, 2000);
    expect(n).toBe(1);
    await getFsLogoMap(pool, 1000 + 6 * 60000);
    expect(n).toBe(2);
  });
  it('the match list carries the crest addresses', () => {
    const r = parseMatchList({ competitions: [{ competition: { name: 'L' }, matches: [{ id: '1', start_time: '2026-11-12T10:00:00Z', home: { name: 'A', logo: U('h') }, away: { name: 'B' } }] }] });
    expect(r[0]).toMatchObject({ homeLogo: U('h'), awayLogo: null });
  });
});
