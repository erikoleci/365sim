import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const money = (n: number) => Number(n || 0).toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const neg = (n: number) => (n < 0 ? 'text-red-500' : n > 0 ? 'text-green-500' : 'text-white');

type Cur = 'ALL' | 'EUR';
const SYMBOL: Record<Cur, string> = { ALL: 'L', EUR: '€' };

// Agents table in the owner's style: Xhiro, Fitim, Në pritje, Bileta aktive, Nr biletave, Përqindja (4/8),
// Diferenca, % Agjentit, Kompania. A click on an agent shows the commission each of his players generated.
const CommissionReport: React.FC<{ scope: 'owner' | 'agent' }> = ({ scope }) => {
  const { t } = useI18n();
  const [data, setData] = useState<api.CommissionReportData | null>(null);
  const [error, setError] = useState('');
  const [month, setMonth] = useState('');
  const [currency, setCurrency] = useState<'ALL' | 'EUR' | 'BOTH'>('BOTH');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const m = month || undefined;
      setData(scope === 'agent' ? await api.agentFetchCommissionReport(m) : await api.adminFetchCommissionReport(m));
      setError('');
    } catch (e: any) { setError(e?.message || t('Veprimi deshtoi')); }
  }, [month, scope, t]);
  useEffect(() => { load(); }, [load]);

  const curs: Cur[] = currency === 'BOTH' ? ['ALL', 'EUR'] : [currency];
  const rate = data ? `${data.rates.single}/${data.rates.multi}` : '4/8';
  const q = search.trim().toLowerCase();

  const cells = (m: api.CommissionMetrics, c: Cur, bold = false) => (
    <>
      <td className="px-2 py-2 text-right">{money(m.xhiro)}</td>
      <td className="px-2 py-2 text-right">{money(m.fitim)}</td>
      <td className="px-2 py-2 text-right">{money(m.pending)}</td>
      <td className="px-2 py-2 text-right">{m.activeTickets}</td>
      <td className="px-2 py-2 text-right">{m.tickets}</td>
      <td className="px-2 py-2 text-center">{rate}</td>
      <td className={'px-2 py-2 text-right font-bold ' + neg(m.diferenca)}>{money(m.diferenca)}</td>
      <td className={'px-2 py-2 text-right font-bold ' + neg(m.percAgjentit)}>{money(m.percAgjentit)}</td>
      <td className={'px-2 py-2 text-right font-bold ' + neg(m.kompania)}>{money(m.kompania)}{bold ? '' : ''}</td>
      <td className="px-2 py-2 text-center text-brand-textMuted">{SYMBOL[c]}</td>
    </>
  );

  const rowsOf = (label: React.ReactNode, cur: api.CommissionMetricsByCur, extra = '', onClick?: () => void, key?: string) =>
    curs.map((c, i) => (
      <tr key={(key ?? '') + c} className={'border-b border-[#444] ' + extra + (onClick ? ' cursor-pointer hover:bg-white/5' : '')} onClick={onClick}>
        <td className="px-2 py-2 text-left">{i === 0 ? label : ''}</td>
        {cells(cur[c], c)}
      </tr>
    ));

  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (!data) return <div className="text-sm text-brand-textMuted">{t('Duke ngarkuar...')}</div>;

  return (
    <div className="bg-brand-panel border border-[#444] rounded p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <label className="text-brand-textMuted">{t('Monedha')}:</label>
        <select className="input w-32" value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
          <option value="ALL">Lek (L)</option>
          <option value="EUR">Euro (€)</option>
          <option value="BOTH">{t('Të gjitha')}</option>
        </select>
        <input type="month" className="input w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className="px-3 py-2 rounded bg-[#333] hover:bg-[#444] font-bold" onClick={() => setMonth('all')}>{t('Gjithë periudha')}</button>
        <input className="input w-44" placeholder={t('Kërko…')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="px-3 py-2 rounded bg-green-700 hover:bg-green-600 font-bold" onClick={load}>{t('Filtro')}</button>
      </div>
      <div className="text-[11px] text-brand-textMuted mb-3">
        {t('Komisioni: {single}% live dhe rezultat tek, {multi}% dy ose më shumë rezultate. Llogaritet mbi kuponat e mbyllur. Muaji: {month}', { single: data.rates.single, multi: data.rates.multi, month: data.month })}
      </div>
      {currency !== 'BOTH' && data.totals[currency === 'ALL' ? 'EUR' : 'ALL'].tickets > 0 && data.totals[currency].tickets === 0 && (
        <div className="text-xs text-yellow-400 mb-2">{t('Nuk ka kupona në këtë monedhë, por ka në tjetrën. Zgjidh "Të gjitha".')}</div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="bg-[#c8102e] text-white">
              {[scope === 'agent' ? t('Lojtari') : t('Agjenti'), t('Xhiro'), t('Fitim'), t('Në pritje'), t('Bileta aktive'), t('Nr biletave'), t('Përqindja'), t('Diferenca'), t('% Agjentit'), t('Kompania'), ''].map((h, i) => (
                <th key={i} className={'px-2 py-2 ' + (i === 0 ? 'text-left' : 'text-right')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g, gi) => (
              <React.Fragment key={g.admin.id ?? 'none'}>
                {scope === 'owner' && (
                  <tr className="bg-black/40"><td colSpan={11} className="px-2 py-1.5 text-brand-yellow font-bold">
                    {g.admin.id ? `${g.admin.name} (@${g.admin.username})` : t('Pa pronar (asnjë admin)')}
                  </td></tr>
                )}
                {g.rows.filter((r) => !q || `${r.name} ${r.username}`.toLowerCase().includes(q) || r.players.some((p) => `${p.name} ${p.username}`.toLowerCase().includes(q))).map((r) => {
                  const k = `${gi}-${r.id ?? 'direct'}`;
                  const isOpen = open[k] ?? (scope === 'agent' || !!q);
                  const label = r.direct
                    ? t('Usera pa agjent')
                    : <span>{scope === 'owner' && <span className="text-brand-yellow mr-1">{isOpen ? '▾' : '▸'}</span>}<b>{r.name}</b> <span className="text-brand-textMuted">@{r.username} · {r.players.length} {t('lojtarë')}</span></span>;
                  return (
                    <React.Fragment key={k}>
                      {scope === 'owner' && rowsOf(label, r.currencies, 'bg-white/5', () => setOpen((p) => ({ ...p, [k]: !isOpen })), k)}
                      {isOpen && (
                        <>
                          {scope === 'owner' && (
                            <tr><td colSpan={11} className="px-2 pt-2 pb-1 text-[10px] uppercase text-brand-textMuted">{t('Komisioni i çdo lojtari')}</td></tr>
                          )}
                          {r.players.map((p) => rowsOf(
                            <span className={'pl-4 ' + (p.isActive ? '' : 'line-through text-brand-textMuted')}>{p.name} <span className="text-brand-textMuted">@{p.username}</span></span>,
                            p.currencies, 'bg-black/20', undefined, `${k}-${p.id}`
                          ))}
                          {r.players.length === 0 && <tr><td colSpan={11} className="px-2 py-2 text-brand-textMuted pl-6">{t('Asnjë lojtar.')}</td></tr>}
                        </>
                      )}
                    </React.Fragment>
                  );
                })}
                {scope === 'owner' && rowsOf(<b>{t('Totali')}</b>, g.totals, 'border-b-4 border-b-[#555] font-bold', undefined, `tot-${gi}`)}
              </React.Fragment>
            ))}
            {scope === 'owner' && data.groups.length > 1 && rowsOf(<b>{t('TOTALI I PËRGJITHSHËM')}</b>, data.totals, 'bg-[#c8102e]/30 font-bold', undefined, 'grand')}
            {data.groups.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-brand-textMuted">{t('Asnjë e dhënë.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CommissionReport;
