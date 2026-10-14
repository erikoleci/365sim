import { describe, it, expect } from 'vitest';
import { determineLegOutcome, ticketIsDecided, findDecidedPendingTickets } from '../server/matchSettlement.js';

const L = (market_name, selection) => ({
  market_id: 'x_m1', market_name, selection_id: selection, selection_name: selection,
  match_home: 'Zakynthos', match_away: 'Apollon Kalamarias',
});
const R = (h, a, ht) => ({
  winner: h > a ? 'HOME' : a > h ? 'AWAY' : 'DRAW', totalGoals: h + a, bothScored: h > 0 && a > 0,
  homeScore: h, awayScore: a, htHome: ht?.[0], htAway: ht?.[1],
});

describe('combination markets (every part must win)', () => {
  it('wins only when both parts win', () => {
    expect(determineLegOutcome(L('Rezultat Final & Totali', '1 & Lart 2.5'), R(3, 0))).toBe('WON');
  });
  it('loses as soon as one part loses', () => {
    expect(determineLegOutcome(L('Rezultat Final & Totali', '1 & Lart 2.5'), R(1, 0))).toBe('LOST'); // total fails
    expect(determineLegOutcome(L('Rezultat Final & Totali', '1 & Lart 2.5'), R(0, 3))).toBe('LOST'); // result fails
  });
  it('a lost part decides the bet even if another part is not understood', () => {
    expect(determineLegOutcome(L('Rezultat Final & Treg i Panjohur', '2 & Diçka'), R(2, 0))).toBe('LOST');
  });
  it('an unknown part with the others winning is left for manual review (never guessed)', () => {
    expect(determineLegOutcome(L('Rezultat Final & Treg i Panjohur', '1 & Diçka'), R(2, 0))).toBeNull();
  });
  it('works with three parts and with BTTS', () => {
    expect(determineLegOutcome(L('Rezultat Final & Gol/Jogol & Totali', '1 & Po & Lart 2.5'), R(2, 1))).toBe('WON');
    expect(determineLegOutcome(L('Rezultat Final & Gol/Jogol & Totali', '1 & Po & Lart 2.5'), R(2, 0))).toBe('LOST');
  });
  it('a part refunded (push) is not settled automatically', () => {
    expect(determineLegOutcome(L('Rezultat Final & Totali', '1 & Lart 3'), R(3, 0))).toBeNull();
  });
  it('a "&" in only one of market/selection is not treated as a combo', () => {
    expect(determineLegOutcome(L('Rezultat Final', '1 & Lart 2.5'), R(3, 0))).toBeNull();
  });
});

describe('half-time / full-time double', () => {
  it('settles from the stored half-time score and the final score', () => {
    const r = R(3, 1, [0, 1]); // HT: away leads, FT: home wins -> 2/1
    expect(determineLegOutcome(L('Pushim/Fund', '2/1'), r)).toBe('WON');
    expect(determineLegOutcome(L('Pushim/Fund', '1/1'), r)).toBe('LOST');
    expect(determineLegOutcome(L('HT/FT', 'X/1'), R(2, 0, [0, 0]))).toBe('WON');
  });
  it('without a stored half-time score it stays pending', () => {
    expect(determineLegOutcome(L('Pushim/Fund', '1/1'), R(2, 0))).toBeNull();
  });
});

describe('ticketIsDecided (when a ticket must stop being open)', () => {
  it('open while legs are only won / pending', () => {
    expect(ticketIsDecided(['WON', 'PENDING'])).toBe(false);
    expect(ticketIsDecided(['PENDING', 'PENDING'])).toBe(false);
  });
  it('decided as soon as one leg is LOST, even with other legs still pending', () => {
    expect(ticketIsDecided(['LOST', 'PENDING', 'PENDING'])).toBe(true);
  });
  it('decided when no leg is left pending; an empty ticket never is', () => {
    expect(ticketIsDecided(['WON', 'WON'])).toBe(true);
    expect(ticketIsDecided(['WON', 'VOID'])).toBe(true);
    expect(ticketIsDecided([])).toBe(false);
  });
});

describe('findDecidedPendingTickets (recovery of stuck tickets)', () => {
  it('returns the stuck accumulator with a lost leg and the all-decided one, not the open ones', async () => {
    const rows = [
      { bet_id: 'stuckLost', status: 'LOST' }, { bet_id: 'stuckLost', status: 'PENDING' },
      { bet_id: 'allWon', status: 'WON' }, { bet_id: 'allWon', status: 'WON' },
      { bet_id: 'openOne', status: 'WON' }, { bet_id: 'openOne', status: 'PENDING' },
      { bet_id: 'single', status: 'PENDING' },
    ];
    const client = { query: async () => ({ rows }) };
    expect((await findDecidedPendingTickets(client)).sort()).toEqual(['allWon', 'stuckLost']);
  });
});
