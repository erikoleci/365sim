// Decodes the gamedetails `VC` attribute into "what is happening on the pitch
// right now" (the line the provider shows inside its green pitch widget, e.g.
// "Hapoel Tel Aviv - Korne").
//
// VERIFIED ONLY AGAINST CAPTURES the site owner labelled by hand while
// watching the provider's pitch (Hapoel Tel Aviv v Hapoel Haifa). The first
// digit is the team (1 = home, 2 = away; confirmed against the per-team
// counters that moved together with each event: C1 for a home corner, H2 for
// a home offside, H4 for a home dangerous attack, A3 / A4 for away attacks /
// dangerous attacks). The rest is the action code.
//
// Anything not in this table returns null on purpose -- an unknown code must
// show nothing rather than a guessed label (no fabricated live data).
//
//   captured VC  -> owner's label
//   11000 / 21000  sulm i rrezikshem   (dangerous attack)
//   21001          sulm                (attack)
//   21002          zoterin topin       (holding the ball)
//   21007          rivene fundore
//   11004          korne               (corner)
//   11234          pozicion jashte loje (offside)
// NOTE: the side of 21002 and 21007 is taken from the same first-digit rule;
// no counter moved with those two to double-check it.

const ACTIONS = {
  '1000': { kind: 'dangerous_attack', label: 'Sulm i rrezikshëm' },
  '1001': { kind: 'attack', label: 'Sulm' },
  '1002': { kind: 'possession', label: 'Zotëron topin' },
  '1004': { kind: 'corner', label: 'Korne' },
  '1007': { kind: 'back_line_restart', label: 'Rivënie fundore' },
  '1234': { kind: 'offside', label: 'Pozicion jashtë loje' },
};

export function decodeLiveAction(vc) {
  const s = String(vc ?? '').trim();
  if (!/^[12]\d+$/.test(s)) return null;
  const entry = ACTIONS[s.slice(1)];
  if (!entry) return null;
  return { side: s[0] === '1' ? 'home' : 'away', kind: entry.kind, label: entry.label };
}
