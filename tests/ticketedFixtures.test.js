import { describe, it, expect, beforeEach } from 'vitest';
import { isTicketedFixture, __setTicketedFixturesForTests } from '../server/london365/ticketedFixtures.js';

describe('isTicketedFixture', () => {
  beforeEach(() => __setTicketedFixturesForTests([{ home: 'HB Koege', away: 'AGF Aarhus' }]));
  it('lets the in-play record of a fixture with an open ticket through the league filter', () => {
    expect(isTicketedFixture({ home_team: 'HB Køge', away_team: 'AGF Aarhus' })).toBe(true);
    expect(isTicketedFixture({ home_team: 'HB Koege', away_team: 'AGF Aarhus' })).toBe(true);
  });
  it('does not open the filter for an unrelated game', () => {
    expect(isTicketedFixture({ home_team: 'Rhyl', away_team: 'Holyhead' })).toBe(false);
    expect(isTicketedFixture({ home_team: 'Torino', away_team: 'Lecce' })).toBe(false);
  });
  it('ignores payloads without team names', () => {
    expect(isTicketedFixture({})).toBe(false);
    expect(isTicketedFixture(null)).toBe(false);
  });
});
