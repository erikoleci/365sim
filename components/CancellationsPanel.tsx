import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const money = (n: number, c: 'ALL' | 'EUR') => (n < 0 ? '−' : '') + (c === 'EUR' ? '€' : '') + Math.abs(n).toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (c === 'ALL' ? ' L' : '');
const when = (ms: number) => new Date(ms).toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Super admin: every ticket an admin cancelled, with the reason he wrote. Unread ones are highlighted; opening the tab marks them read. */
const CancellationsPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const { t } = useI18n();
  const [items, setItems] = useState<api.TicketCancellation[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api.adminFetchCancellations();
      setItems(r.items); setError(false);
      if (r.unread > 0) { await api.adminMarkCancellationsSeen().catch(() => {}); onChanged?.(); }
    } catch { setError(true); }
  }, [onChanged]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="p-4 text-sm text-red-400">{t('Veprimi deshtoi')} <button onClick={load} className="underline ml-2">{t('Provo përsëri')}</button></div>;
  if (!items) return <div className="p-4 text-sm text-brand-textMuted">…</div>;
  return (
    <div className="p-3 sm:p-4 max-w-4xl mx-auto">
      <div className="text-sm text-brand-textMuted mb-3">{t('Biletat e anuluara dhe arsyeja që shkroi secili. Të reja shfaqen me të kuqe.')}</div>
      {items.length === 0 ? <div className="text-brand-textMuted text-sm">{t('Asnjë anulim ende.')}</div> : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} className={`rounded-lg border p-3 text-sm ${c.seenAt == null ? 'border-red-500 bg-red-900/20' : 'border-[#444] bg-brand-panel'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-white">#{c.ticketNo ?? c.betId.slice(0, 6)} · {c.playerUsername ?? c.userId}</span>
                <span className="text-xs text-brand-textMuted">{when(c.createdAt)}</span>
              </div>
              <div className="mt-1 text-xs text-brand-textMuted">
                {t('Anuluar nga')}: <b className="text-white">{c.actorUsername ?? c.actorId}</b>{c.actorRole === 'SUPER_ADMIN' ? ' (super admin)' : ''} · {t('Shuma')}: <b className="text-white">{money(c.stake, c.currency)}</b> · {t('Statusi')}: {c.statusBefore ?? '—'}{c.decidedLegs > 0 ? ` · ${c.decidedLegs} ${t('ndeshje me rezultat')}` : ''} · {t('Kthyer')}: {money(c.balanceChange, c.currency)}
              </div>
              <div className="mt-2 rounded bg-black/30 px-2 py-1.5 text-white">{c.reason ? c.reason : <span className="text-brand-textMuted">{t('(pa arsye)')}</span>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default CancellationsPanel;
