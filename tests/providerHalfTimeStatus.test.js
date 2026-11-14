import { describe, it, expect } from 'vitest';
import { normalizeProviderStatus } from '../server/halfTimeLatch.js';

describe('provider numeric status', () => {
  it('2 at 45:00 is half-time, the others pass through, missing stays null', () => {
    expect(normalizeProviderStatus('2', '45:00')).toBe('HT');
    expect(normalizeProviderStatus(2, '45:00')).toBe('HT');
    expect(normalizeProviderStatus('2', '48:37')).toBe('2');
    expect(normalizeProviderStatus('1', '45:00')).toBe('1');
    expect(normalizeProviderStatus('3', '60:00')).toBe('3');
    expect(normalizeProviderStatus(null)).toBe(null);
    expect(normalizeProviderStatus(undefined)).toBe(null);
  });
});
