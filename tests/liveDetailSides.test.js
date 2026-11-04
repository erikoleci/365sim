import { describe, it, expect } from 'vitest';
import { sameTeam } from '../server/fixtureDedupe.js';

describe('goal side names', () => {
  it('matches the in-play spelling to the record names', () => {
    expect(sameTeam('Manchester City', 'Man City')).toBe(true);
    expect(sameTeam('Arsenal', 'Manchester City')).toBe(false);
  });
});
