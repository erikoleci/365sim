import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const money = (n: number) => Number(n || 0).toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const neg = (n: number) => (n < 0 ? 'text-red-500' : n > 0 ? 'text-green-500' : 'text-white');

type Cur = 'ALL' | 'EUR';
const SYMBOL: Record<Cur, string> = { ALL: 'L', EUR: '€' };

// Agents table in the owner's style: Xhiro, Fitim, Në pritje, Bileta aktive, Nr biletave, Përqindja (4/8),
// Diferenca, % Agjentit, Kompania. A click on an agent shows the commission each of his players generated.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// First and last day of the month `offset` months from now (0 = this month, -1 = last month).
const monthBounds = (offset: number) => {
  const n = new Date();
  return { from: ymd(new Date(n.getFullYear(), n.getMonth() + offset, 1)), to: ymd(new Date(n.getFullYear(), n.getMonth() + offset + 1, 0)) };
};
const monthName = (offset: number) => {
  const n = new Date();
  const s = new Date(n.getFullYear(), n.getMonth() + offset, 1).toLocaleString(getLocale(), { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const CommissionReport: React.FC<{ scope: 'owner' | 'agent' }> = ({ scope }) => {
  const { t } = useI18n();
  const [data, setData] = useState<api.CommissionReportData | null>(null);
  const [error, setError] = useState('');
  // Period like the agents' finance page: two dates + quick buttons (Sot, Dje, this month, last month, the year, all).
  const [from, setFrom] = useState(() => monthBounds(0).from);
  const [to, setTo] = useState(() => monthBounds(0).to);
  const [preset, setPreset] = useState('thisMonth');
  const [applied, setApplied] = useState<api.ReportPeriod>(() => monthBounds(0));
  const [currency, setCurrency] = useState<'ALL' | 'EUR' | 'BOTH'>('BOTH');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setData(scope === 'agent' ? await api.agentFetchCommissionReport(applied) : await api.adminFetchCommissionReport(applied));
      setError('');
    } catch (e: any) { setError(e?.message || t('Veprimi deshtoi')); }
  }, [applied, scope, t]);
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
      <td className={'px-2 py-2 text-right font-bold ' + 'text-white'}>{money(m.percAgjentit)}</td>
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
        <input type="date" className="input w-36" value={from} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} />
        <input type="date" className="input w-36" value={to} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} />
        <input className="input w-44" placeholder={t('Kërko…')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="px-3 py-2 rounded bg-green-700 hover:bg-green-600 font-bold" onClick={() => { setPreset('custom'); setApplied({ from, to }); }}>{t('Filtro')}</button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-5 mb-3 text-sm">
        {([
          { key: 'today', label: t('Sot'), from: ymd(new Date()), to: ymd(new Date()) },
          { key: 'yesterday', label: t('Dje'), from: ymd(new Date(Date.now() - 86400000)), to: ymd(new Date(Date.now() - 86400000)) },
          { key: 'thisMonth', label: monthName(0), ...monthBounds(0) },
          { key: 'lastMonth', label: monthName(-1), ...monthBounds(-1) },
          { key: 'year', label: String(new Date().getFullYear()), from: `${new Date().getFullYear()}-01-01`, to: `${new Date().getFullYear()}-12-31` },
          { key: 'all', label: t('Gjithë periudha'), month: 'all' as string | undefined, from: '', to: '' },
        ]).map((p) => (
          <button
            key={p.key}
            className={'pb-1 font-bold border-b-2 ' + (preset === p.key ? 'border-brand-accent text-white' : 'border-transparent text-brand-textMuted hover:text-white')}
            onClick={() => {
              setPreset(p.key); setFrom(p.from); setTo(p.to);
              setApplied(p.month ? { month: p.month } : { from: p.from, to: p.to });
            }}
          >{p.label}</button>
        ))}
      </div>
      <div className="text-[11px] text-brand-textMuted mb-3">
        {t('Komisioni: {single}% rezultat tek, {multi}% dy ose më shumë rezultate (edhe me live). Llogaritet mbi stake-un e çdo bilete të vendosur (jo të anuluarat dhe të rimbursuarat). Diferenca = Xhiro − Fitim − Komisioni. Periudha: {month}', { single: data.rates.single, multi: data.rates.multi, month: data.month })}
      </div>
      {(() => {
        // What the admin has to pay out: the commission of every agent, in lek and in euro (never added together).
        const agentRows = data.groups.flatMap((g) => g.rows.filter((r) => !r.direct));
        const sum = (c: Cur) => (scope === 'agent' ? data.totals[c].percAgjentit : agentRows.reduce((a, r) => a + (r.currencies[c].percAgjentit || 0), 0));
        const shown = scope === 'agent' ? [] : agentRows.filter((r) => curs.some((c) => r.currencies[c].percAgjentit > 0));
        return (
          <div className="mb-4 rounded-lg border-2 border-brand-yellow/70 bg-brand-yellow/10 p-3">
            <div className="text-xs uppercase tracking-wide text-brand-yellow font-bold">{scope === 'agent' ? t('Komisioni yt') : t('Komisioni që duhet t\'u jepet agjentëve')}</div>
            <div className="flex flex-wrap gap-x-8 gap-y-1 mt-1">
              {curs.map((c) => (
                <div key={c} className="text-2xl font-extrabold text-white tabular-nums">{money(sum(c))} <span className="text-base text-brand-textMuted">{SYMBOL[c]}</span></div>
              ))}
            </div>
            {shown.length > 0 && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {shown.map((r) => (
                  <div key={r.id ?? 'x'} className="flex justify-between gap-3 border-b border-white/10 py-1">
                    <span><b>{r.name}</b> <span className="text-brand-textMuted text-xs">@{r.username}</span></span>
                    <span className="tabular-nums font-bold">
                      {curs.filter((c) => r.currencies[c].percAgjentit > 0).map((c) => `${money(r.currencies[c].percAgjentit)} ${SYMBOL[c]}`).join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
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
            {scope === 'agent' && data.groups.length > 0 && rowsOf(<b>{t('Totali')}</b>, data.totals, 'border-b-4 border-b-[#555] font-bold', undefined, 'tot-agent')}
            {scope === 'owner' && data.groups.length > 1 && rowsOf(<b>{t('TOTALI I PËRGJITHSHËM')}</b>, data.totals, 'bg-[#c8102e]/30 font-bold', undefined, 'grand')}
            {data.groups.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-brand-textMuted">{t('Asnjë e dhënë.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CommissionReport;
