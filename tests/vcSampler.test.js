import { describe, it, expect, beforeEach } from 'vitest';
import { recordVcSample, getVcSamples, __resetVcSamplesForTests } from '../server/vcSampler.js';

describe('vcSampler', () => {
  beforeEach(() => __resetVcSamplesForTests());
  it('groups both sides under one code and separates unlabelled codes', () => {
    recordVcSample('11010', 'Gjuajtje e lirë', { match: 'A - B', score: '0-0', t: '748' });
    recordVcSample('21010', 'Gjuajtje e lirë', {});
    recordVcSample('21555', null, { match: 'C - D', score: '1-0', t: '3000' });
    recordVcSample('abc', null, {});
    const r = getVcSamples();
    expect(r.labelled).toHaveLength(1);
    expect(r.labelled[0]).toMatchObject({ code: '1010', count: 2, home: 1, away: 1 });
    expect(r.unlabelled[0]).toMatchObject({ code: '1555', count: 1, away: 1 });
    expect(r.unlabelled[0].example.match).toBe('C - D');
  });
});
