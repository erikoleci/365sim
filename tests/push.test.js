import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/db.js', () => ({ default: { query: vi.fn() } }));
import { ticketMessage, matchMessage } from '../server/push.js';

describe('push messages', () => {
  it('won ticket shows the payout', () => {
    const m = ticketMessage({ status: 'WON', ticket_no: 12, potential_return: 25.5, currency: 'EUR' });
    expect(m.body).toBe('Bileta #12 fitoi 25.50 €');
  });
  it('lost and void', () => {
    expect(ticketMessage({ status: 'LOST', ticket_no: 3 }).body).toBe('Bileta #3 humbi');
    expect(ticketMessage({ status: 'VOID', ticket_no: 4, stake: 10, currency: 'LLOT' }).body).toContain('10.00 L');
  });
  it('pending ticket gives nothing, match shows score', () => {
    expect(ticketMessage({ status: 'PENDING' })).toBeNull();
    expect(matchMessage({ home_team: 'A', away_team: 'B', result_home: 2, result_away: 1 }).body).toBe('A 2–1 B');
  });
});
