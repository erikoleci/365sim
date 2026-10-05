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
//   21024          rivenje anesore     (throw-in)
//   21011          goditje ne porte    (shot on target)
//   11013          nderrim             (substitution)
//   1015           pushim              (end of first half; seen with T=2700, SC=2-1,
//                                       Odd 2 v Viking 2, no team digit)
// NOTE: the side of 21002 and 21007 is taken from the same first-digit rule;
// no counter moved with those two to double-check it.

const ACTIONS = {
  '1000': { kind: 'dangerous_attack', label: 'Sulm i rrezikshëm' },
  '1001': { kind: 'attack', label: 'Sulm' },
  '1002': { kind: 'possession', label: 'Zotëron topin' },
  '1004': { kind: 'corner', label: 'Korne' },
  '1007': { kind: 'back_line_restart', label: 'Rivënie fundore' },
  '1011': { kind: 'shot_on_target', label: 'Goditje në portë' },
  '1013': { kind: 'substitution', label: 'Ndërrim' },
  '1015': { kind: 'half_time', label: 'Pushim' },
  '1024': { kind: 'throw_in', label: 'Rivënie anësore' },
  '1234': { kind: 'offside', label: 'Pozicion jashtë loje' },
};

const LABELS = Object.fromEntries(Object.values(ACTIONS).map((a) => [a.kind, a.label]));
// Build an action from a side and a kind (used by the counter-derived path).
export function makeAction(side, kind) {
  return LABELS[kind] ? { side, kind, label: LABELS[kind] } : null;
}

export function decodeLiveAction(vc) {
  const s = String(vc ?? '').trim();
  // A 4-digit code carries no team digit (seen: VC="1007", labelled "rivene
  // fundore" by the owner): same action table, side unknown.
  if (/^\d{4}$/.test(s) && ACTIONS[s]) return { side: null, kind: ACTIONS[s].kind, label: ACTIONS[s].label };
  if (!/^[12]\d+$/.test(s)) return null;
  const entry = ACTIONS[s.slice(1)];
  if (!entry) return null;
  // The break belongs to neither team, whatever the first digit says.
  const side = entry.kind === 'half_time' ? null : s[0] === '1' ? 'home' : 'away';
  return { side, kind: entry.kind, label: entry.label };
}
