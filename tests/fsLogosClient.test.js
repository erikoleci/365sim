import { describe, it, expect } from 'vitest';
import { __setFsLogosForTests, resolveFsLogo, logoVersion } from '../utils/teamLogos.ts';

describe('Flashscore crests in the browser', () => {
  it('resolves by the normalised key and never guesses', () => {
    __setFsLogosForTests({ 'manchester united': 'https://static.flashscore.com/res/image/data/a.png' });
    expect(resolveFsLogo('Manchester United FC')).toBe('https://static.flashscore.com/res/image/data/a.png');
    expect(resolveFsLogo('Manchester City')).toBeNull();
    expect(logoVersion() & 2).toBe(2);
    __setFsLogosForTests(null);
    expect(resolveFsLogo('Manchester United FC')).toBeNull();
  });
});
