import React, { useState } from 'react';
import * as api from '../services/api';
import { useI18n } from '../i18n';

/** Admin: "Why is this ticket still open?" — the state of every open leg's match, in plain words. */
const TicketWhy: React.FC<{ betId: string }> = ({ betId }) => {
  const { t } = useI18n();
  const [legs, setLegs] = useState<api.OpenLegWhy[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const load = async () => {
    setBusy(true); setError(false);
    try { setLegs((await api.adminBetWhy(betId)).legs); } catch { setError(true); } finally { setBusy(false); }
  };

  return (
    <div className="w-full">
      <button onClick={load} disabled={busy} className="w-full px-3 py-2 rounded bg-[#222] text-brand-yellow text-xs font-bold uppercase disabled:opacity-50">
        {busy ? t('Duke kontrolluar...') : t('Pse është hapur?')}
      </button>
      {error && <div className="text-xs text-red-400 mt-2">{t('Kontrolli deshtoi.')}</div>}
      {legs && (
        <div className="mt-2 space-y-2">
          {legs.length === 0 && <div className="text-xs text-brand-textMuted">{t('Asnjë zgjedhje e hapur: të gjitha janë vendosur.')}</div>}
          {legs.map((l) => (
            <div key={l.legId} className="bg-[#161616] border border-[#333] rounded p-2 text-xs">
              <div className="font-bold">{l.match}</div>
              <div className="text-brand-textMuted">{l.selection}</div>
              <div className="mt-1">{l.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TicketWhy;
