import React, { useEffect, useMemo, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const money = (n: number) => Number(n || 0).toLocaleString(getLocale(), { maximumFractionDigits: 2 });
const when = (ms: number) => new Date(ms).toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** An admin's own page: the credit the super admin gave him, with date and time. */
const MyCredits: React.FC = () => {
  const { t } = useI18n();
  const [data, setData] = useState<api.MyCredits | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { api.adminFetchMyCredits().then(setData).catch(() => setError(true)); }, []);
  // "From this date to that date": the credit received in that period (local days; empty = all time).
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const fromMs = from ? new Date(from + 'T00:00:00').getTime() : null;
  const toMs = to ? new Date(to + 'T23:59:59.999').getTime() : null;
  const shown = useMemo(() => (data?.credits ?? []).filter((c) => (fromMs == null || c.at >= fromMs) && (toMs == null || c.at <= toMs)), [data, fromMs, toMs]);
  const sum = useMemo(() => {
    const r = { ALL: 0, EUR: 0 }; const tst = { ALL: 0, EUR: 0 };
    for (const c of shown) (c.isTest ? tst : r)[c.currency] += c.amount;
    return { real: r, test: tst };
  }, [shown]);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const preset = (k: 'today' | '7d' | 'month' | 'all') => {
    const now = new Date();
    if (k === 'all') { setFrom(''); setTo(''); } else if (k === 'today') { setFrom(ymd(now)); setTo(ymd(now)); }
    else if (k === '7d') { const d = new Date(now); d.setDate(d.getDate() - 6); setFrom(ymd(d)); setTo(ymd(now)); }
    else { setFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(ymd(now)); }
  };
  const hasRange = fromMs != null || toMs != null;
  if (!data) return <div className="text-sm text-brand-textMuted py-10 text-center">{error ? t('Ngarkimi deshtoi.') : t('Duke ngarkuar...')}</div>;
  return (
    <div className="space-y-4">
      <div className="bg-brand-panel border border-[#444] rounded p-3 flex flex-wrap items-end gap-2">
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">{t('Nga data')}<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="input w-40" /></label>
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">{t('Deri ne daten')}<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="input w-40" /></label>
        {([['today', t('Sot')], ['7d', t('7 ditet e fundit')], ['month', t('Ky muaj')], ['all', t('Gjithe koha')]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => preset(k)} className="px-2.5 py-1.5 rounded border border-[#555] text-xs text-brand-yellow hover:bg-white/5">{label}</button>
        ))}
      </div>
      {hasRange && (
        <div className="grid grid-cols-2 gap-3 max-w-xl">
          <div className="bg-brand-panel border border-yellow-500/60 rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredi e marre ne periudhe')}</div><div className="font-bold leading-tight text-green-400"><div>{money(sum.real.ALL)} L</div><div>€{money(sum.real.EUR)}</div></div></div>
          <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Test / falas (nuk llogaritet)')}</div><div className="font-bold leading-tight text-gray-300"><div>{money(sum.test.ALL)} L</div><div>€{money(sum.test.EUR)}</div></div></div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredi e marre (leke)')}</div><div className="font-bold">{money(data.total.ALL)} L</div></div>
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredi e marre (euro)')}</div><div className="font-bold">€{money(data.total.EUR)}</div></div>
      </div>
      <div className="bg-brand-panel border border-[#444] rounded">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-[#444]">{t('Kredia qe ke marre')}</div>
        {shown.length === 0 ? <div className="text-xs text-brand-textMuted p-4 text-center">{t('Asnje kredi e regjistruar.')}</div> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Data')}</th><th className="p-2 text-right">{t('Shuma')}</th><th className="p-2"></th></tr></thead>
            <tbody>{shown.map((c) => (
              <tr key={c.id} className="border-t border-[#333]">
                <td className="p-2 whitespace-nowrap">{when(c.at)}</td>
                <td className="p-2 text-right font-bold text-green-400 whitespace-nowrap">+{c.currency === 'EUR' ? '€' + money(c.amount) : money(c.amount) + ' L'}</td>
                <td className="p-2">{c.isTest && <span className="px-1.5 py-0.5 rounded bg-gray-600 text-[10px] font-bold uppercase">{t('Test')}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
};
export default MyCredits;
