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

import { recordVcChange, getVcHistory } from '../server/vcSampler.js';
describe('vc history per match', () => {
  it('keeps only CHANGES, newest first, searchable by team name', () => {
    __resetVcSamplesForTests();
    recordVcChange('m1', '11000', { match: 'PSG - Roma', score: '1-1', t: '3600' });
    recordVcChange('m1', '11000', { match: 'PSG - Roma', score: '1-1', t: '3601' });
    recordVcChange('m1', '21023', { match: 'PSG - Roma', score: '1-1', t: '3650', label: 'Penallti' });
    recordVcChange('m2', '11000', { match: 'Inter - Stuttgart', score: '0-0', t: '1' });
    const h = getVcHistory('roma');
    expect(h.length).toBe(1);
    expect(h[0].changes.map((c) => c.vc)).toEqual(['21023', '11000']);
    expect(getVcHistory('')).toEqual([]);
  });
});

import { getRecentVc } from '../server/vcSampler.js';
describe('recent vc before a goal', () => {
  it('returns the last changes of one match, oldest first, with seconds before now', () => {
    __resetVcSamplesForTests();
    recordVcChange('g1', '11000', { match: 'A - B' });
    recordVcChange('g1', '21023', { match: 'A - B' });
    recordVcChange('g2', '11000', { match: 'C - D' });
    const r = getRecentVc('g1');
    expect(r.map((x) => x.vc)).toEqual(['11000', '21023']);
    expect(r[0].s).toBeGreaterThanOrEqual(0);
    expect(getRecentVc('nope')).toEqual([]);
  });
});
