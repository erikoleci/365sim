import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';

/**
 * Admin tab "Pezull": legs of finished matches that the rules cannot decide (penalties, markets
 * with an unknown meaning...). One row = one match + market + selection; the buttons decide every
 * ticket leg of that row at once (the tickets are then paid / closed exactly like automatic ones).
 */
const PendingLegsPanel: React.FC = () => {
  const [rows, setRows] = useState<api.AdminPendingLeg[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api.adminFetchPendingLegs().then((r) => setRows(r.legs)).catch((e) => setError(e?.message || 'Nuk u ngarkua'));
  }, []);
  useEffect(load, [load]);

  const decide = async (r: api.AdminPendingLeg, outcome: 'WON' | 'LOST' | 'VOID') => {
    const label = outcome === 'WON' ? 'FITUES' : outcome === 'LOST' ? 'HUMBËS' : 'RIMBURSIM';
    if (!window.confirm(`${r.match_home} - ${r.match_away}\n${r.market_name}: ${r.selection_name}\n${r.legs} bileta → ${label}. Vazhdo?`)) return;
    const key = `${r.match_id}|${r.market_name}|${r.selection_name}`;
    setBusy(key);
    try {
      await api.adminSettleLegs({ matchId: r.match_id, marketName: r.market_name, selectionName: r.selection_name, outcome });
      load();
    } catch (e: any) {
      setError(e?.message || 'Dështoi');
    } finally {
      setBusy('');
    }
  };

  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (!rows) return <div className="text-brand-textMuted text-sm">Loading...</div>;
  if (rows.length === 0) return <div className="text-brand-textMuted text-sm">Asnjë bilet pezull për ndeshje të mbaruara.</div>;

  return (
    <div className="space-y-3">
      <div className="text-xs text-brand-textMuted">
        Këto janë tregje që sistemi nuk i mbyll dot vetë. Zgjidh rezultatin për çdo rresht (p.sh. penallti: "Po" fitues dhe "Jo" humbës).
      </div>
      {rows.map((r) => {
        const key = `${r.match_id}|${r.market_name}|${r.selection_name}`;
        return (
          <div key={key} className="border border-brand-divider rounded p-3 bg-brand-bg">
            <div className="text-sm text-white font-bold">{r.match_home} - {r.match_away}
              {r.result_home != null && <span className="text-brand-textMuted font-normal"> ({r.result_home}:{r.result_away})</span>}
            </div>
            <div className="text-sm text-brand-text mt-1">{r.market_name}: <b>{r.selection_name}</b></div>
            <div className="text-xs text-brand-textMuted">{r.legs} bileta · {r.bets} fletë</div>
            <div className="flex gap-2 mt-2">
              <button disabled={busy === key} onClick={() => decide(r, 'WON')} className="flex-1 min-h-[44px] rounded bg-brand-accent text-black font-bold text-sm">Fitues</button>
              <button disabled={busy === key} onClick={() => decide(r, 'LOST')} className="flex-1 min-h-[44px] rounded bg-red-600 text-white font-bold text-sm">Humbës</button>
              <button disabled={busy === key} onClick={() => decide(r, 'VOID')} className="flex-1 min-h-[44px] rounded bg-[#555] text-white font-bold text-sm">Rimburso</button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PendingLegsPanel;
