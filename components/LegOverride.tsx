import React, { useEffect, useState } from 'react';
import * as api from '../services/api';
import { useI18n } from '../i18n';

/** Admin, emergencies only: set ONE open match of a ticket as won or lost, so the ticket shows which matches won and which lost. */
const LegOverride: React.FC<{ betId: string; onResolveLeg: (legId: number, outcome: 'WON' | 'LOST') => Promise<void> | void }> = ({ betId, onResolveLeg }) => {
  const { t } = useI18n();
  const [legs, setLegs] = useState<api.OpenLegWhy[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try { setLegs((await api.adminBetWhy(betId)).legs); } catch { setLegs([]); }
  };
  useEffect(() => { load(); }, [betId]);

  if (legs.length === 0) return null;

  const set = async (legId: number, outcome: 'WON' | 'LOST') => {
    if (!window.confirm(outcome === 'WON' ? t('Ta bëj këtë ndeshje FITUESE?') : t('Ta bëj këtë ndeshje HUMBËSE?'))) return;
    setBusy(true);
    try { await onResolveLeg(legId, outcome); await load(); } finally { setBusy(false); }
  };

  return (
    <div className="w-full">
      <button onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2 rounded bg-[#222] text-brand-textMuted text-xs font-bold uppercase">
        {open ? '▴ ' : '▾ '}{t('Vendos ndeshjet veç e veç')} ({legs.length})
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="text-[11px] text-brand-textMuted">{t('Vetëm në raste nevoje')}</div>
          {legs.map((l) => (
            <div key={l.legId} className="bg-[#161616] border border-[#333] rounded p-2 text-xs">
              <div className="font-bold">{l.match}</div>
              <div className="text-brand-textMuted">{l.selection}</div>
              <div className="flex gap-2 mt-2">
                <button disabled={busy} onClick={() => set(l.legId, 'WON')} className="flex-1 px-2 py-1.5 rounded bg-green-900/40 text-green-300 hover:bg-green-800 hover:text-white font-bold uppercase disabled:opacity-50">{t('Fituese')}</button>
                <button disabled={busy} onClick={() => set(l.legId, 'LOST')} className="flex-1 px-2 py-1.5 rounded bg-orange-900/40 text-orange-300 hover:bg-orange-800 hover:text-white font-bold uppercase disabled:opacity-50">{t('Humbëse')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LegOverride;
