import { describe, it, expect } from 'vitest';
import { parseGameDetails } from '../server/gameDetailsParser.js';
import { decodeLiveAction } from '../server/liveAction.js';

// Real `gamedetails` frames of Central Stallions v Deren FC (EID 52628036), each labelled by the owner.
const frame = (vc, t, extra = '') => `42["gamedetails","<Detaje EID="52628036" VC="${vc}" XY="" PG="" AM="" T="${t}" TA="" TT="1" Pj="" SC="3-3" S="" ${extra} H="Central Stallions" A="Deren FC" />"]`;

describe('gamedetails frames labelled by the owner (Central Stallions v Deren FC)', () => {
  it.each([
    ['1017', 5400, { side: null, kind: 'full_time', label: 'Ndeshja mbaroi' }],          // ndeshja mbaroi
    ['11024', 4608, { side: 'home', kind: 'throw_in', label: 'Rivënie anësore' }],        // rivene ansore
    ['21007', 4679, { side: 'away', kind: 'back_line_restart', label: 'Rivënie fundore' }], // rivene fundore
    ['11236', 4827, { side: 'home', kind: 'penalty', label: 'Goditje dënimi' }],          // goditje denimi
    ['21002', 5098, { side: 'away', kind: 'possession', label: 'Zotëron topin' }],        // zoteron topin
    ['11013', 5336, { side: 'home', kind: 'substitution', label: 'Ndërrim' }],            // nderrim
    ['21011', 4679, { side: 'away', kind: 'shot_on_target', label: 'Goditje në portë' }], // goditje ne porte
  ])('VC %s (T=%s) -> %o', (vc, t, expected) => {
    const attrs = parseGameDetails(frame(vc, t));
    expect(attrs).toMatchObject({ EID: '52628036', VC: vc, SC: '3-3' });
    expect(decodeLiveAction(attrs.VC)).toEqual(expected);
  });

  it('the final frame (VC 1017, T=5400, TT=0) belongs to no team, even with a team digit', () => {
    expect(decodeLiveAction('11017')).toMatchObject({ side: null, kind: 'full_time' });
    expect(decodeLiveAction('21017')).toMatchObject({ side: null, kind: 'full_time' });
  });
});
