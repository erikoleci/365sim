import { describe, it, expect } from 'vitest';
import { parseGameDetails } from '../server/gameDetailsParser.js';

function tag(attrs) {
  return '<Detaje ' + Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ') + ' />';
}

describe('parseGameDetails', () => {
  it('extracts every verified field from the real captured sample', () => {
    const raw = tag({
      EID: '52628036', T: '2921', SC: '1-2', H: 'Ramthar Veng FC', A: 'Chanmari FC',
      YC1: '1', YC2: '0', RC1: '0', RC2: '0', H3: '86', XY: '',
    });
    const d = parseGameDetails(raw);
    expect(d.EID).toBe('52628036');
    expect(d.SC).toBe('1-2');
    expect(d.H).toBe('Ramthar Veng FC');
    expect(d.A).toBe('Chanmari FC');
    expect(d.YC1).toBe('1');
    expect(d.YC2).toBe('0');
    expect(d.RC1).toBe('0');
    expect(d.RC2).toBe('0');
    expect(d.T).toBe('2921');
    // Present verbatim (for future analysis) but nothing in the app may
    // treat unverified fields like H3/XY as "minute"/"position"/etc.
    expect(d.H3).toBe('86');
    expect(d.XY).toBe('');
  });

  it('returns null for a tag with no EID', () => {
    expect(parseGameDetails('<Detaje SC="1-2" />')).toBeNull();
  });

  it('returns null for garbage/empty input', () => {
    expect(parseGameDetails('not xml at all')).toBeNull();
    expect(parseGameDetails('')).toBeNull();
    expect(parseGameDetails(null)).toBeNull();
    expect(parseGameDetails(undefined)).toBeNull();
  });

  it('is robust to attribute order and empty-string values', () => {
    const d = parseGameDetails('<Detaje SC="0-0" EID="99" H="A FC" A="B FC" YC1="2" RC2="1" PG="" />');
    expect(d.EID).toBe('99');
    expect(d.SC).toBe('0-0');
    expect(d.YC1).toBe('2');
    expect(d.RC2).toBe('1');
    expect(d.PG).toBe('');
  });
});
