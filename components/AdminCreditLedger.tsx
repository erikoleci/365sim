import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const CACHE_KEY = 'cachedCreditLedger';
const readCache = (): api.CreditLedger | null => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
};

const money = (n: number) => Number(n || 0).toLocaleString(getLocale(), { maximumFractionDigits: 2 });
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
// Lek and euro are shown on two lines and never added together.
const Pair: React.FC<{ v: api.Dual; className?: string }> = ({ v, className = '' }) => (
  <div className={`font-bold leading-tight ${className}`}>
    <div>{money(v.ALL)} L</div>
    <div>€{money(v.EUR)}</div>
  </div>
);

/** Super admin: credit given to each admin, what is left, and the cash kept for every credit. */
const AdminCreditLedger: React.FC = () => {
  const { t } = useI18n();
  const [ledger, setLedger] = useState<api.CreditLedger | null>(readCache); // paints at once, refreshed below
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('');
  const [adminId, setAdminId] = useState('');
  const [lek, setLek] = useState('');
  const [eur, setEur] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.adminFetchCreditLedger();
      setLedger(data);
      setError(false);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
    } catch (e) { console.error('Failed to load credit ledger', e); setError(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const a = Number(lek) || 0;
    const b = Number(eur) || 0;
    if (!adminId || (a <= 0 && b <= 0) || a < 0 || b < 0) return;
    const admin = ledger?.admins.find((x) => x.id === adminId);
    const rate = Math.round((ledger?.feeRate ?? 0.1) * 100);
    const msg = `${admin?.name || ''}: ${a > 0 ? money(a) + ' L' : ''}${a > 0 && b > 0 ? ' + ' : ''}${b > 0 ? '€' + money(b) : ''}\n` +
      t('Para dore ({rate}%): {cash}', { rate: String(rate), cash: `${a > 0 ? money(a * rate / 100) + ' L' : ''}${a > 0 && b > 0 ? ' + ' : ''}${b > 0 ? '€' + money(b * rate / 100) : ''}` });
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.adminCreditAdmin(adminId, a, b);
      setLek(''); setEur('');
      await load();
    } catch (err: any) {
      alert(err.message || t('Veprimi deshtoi'));
    } finally { setBusy(false); }
  };

  // The book as a spreadsheet (opens in Excel): date, admin, action, currency, amount and the cash kept.
  const downloadCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Data', 'Admini', 'Veprimi', 'Monedha', 'Shuma', 'Para dore', 'Perqindja'].map(esc).join(',')];
    for (const h of history) {
      lines.push([
        new Date(h.at).toISOString().replace('T', ' ').slice(0, 19), h.adminName, h.kind === 'CREDIT' ? 'Kredi' : 'Marre mbrapsht',
        h.currency === 'EUR' ? 'EUR' : 'ALL', h.amount, h.kind === 'CREDIT' ? h.cash : '', h.kind === 'CREDIT' && h.feeRate != null ? Math.round(h.feeRate * 100) + '%' : '',
      ].map(esc).join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kredia-adminet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const history = useMemo(() => (ledger?.history ?? []).filter((h) => !filter || h.adminId === filter), [ledger, filter]);
  const feePct = Math.round((ledger?.feeRate ?? 0.1) * 100);

  if (!ledger) {
    return <div className="text-sm text-brand-textMuted py-10 text-center">{error ? t('Ngarkimi deshtoi.') : t('Duke ngarkuar...')}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredi e dhene')}</div><Pair v={ledger.totals.given} /></div>
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Marre mbrapsht')}</div><Pair v={ledger.totals.takenBack} /></div>
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Mbetur te adminet')}</div><Pair v={ledger.totals.remaining} /></div>
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Para dore ({rate}%)', { rate: String(feePct) })}</div><Pair v={ledger.totals.cash} className="text-green-400" /></div>
      </div>

      <form onSubmit={submit} className="bg-brand-panel border border-[#444] rounded p-3 flex flex-wrap items-end gap-2">
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">
          {t('Admini')}
          <select value={adminId} onChange={(e) => setAdminId(e.target.value)} className="input w-48">
            <option value="">—</option>
            {ledger.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">
          {t('Leke')}
          <input type="number" min="0" inputMode="decimal" value={lek} onChange={(e) => setLek(e.target.value)} className="input w-32" placeholder="100000" />
        </label>
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">
          {t('Euro')}
          <input type="number" min="0" inputMode="decimal" value={eur} onChange={(e) => setEur(e.target.value)} className="input w-28" placeholder="1000" />
        </label>
        <button type="submit" disabled={busy || !adminId} className="px-4 py-2 rounded bg-brand-yellow text-black text-xs font-bold uppercase disabled:opacity-50">{t('Shto kredi')}</button>
      </form>

      <div className="grid gap-3 md:grid-cols-2">
        {ledger.admins.map((a) => {
          const low = (a.leftPct.ALL != null && a.leftPct.ALL <= 20) || (a.leftPct.EUR != null && a.leftPct.EUR <= 20);
          return (
            <div key={a.id} className={'bg-brand-panel border rounded p-3 ' + (low ? 'border-red-500' : 'border-[#444]')}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold">{a.name} <span className="text-xs text-brand-textMuted">@{a.username}</span></div>
                <button onClick={() => setFilter(filter === a.id ? '' : a.id)} className="text-[10px] uppercase text-brand-yellow">{filter === a.id ? t('Shfaq te gjitha') : t('Shiko historine')}</button>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div><div className="text-[10px] uppercase text-brand-textMuted">{t('Dhene')}</div><Pair v={a.given} /></div>
                <div><div className="text-[10px] uppercase text-brand-textMuted">{t('Mbetur')}</div><Pair v={a.remaining} className={low ? 'text-red-400' : 'text-white'} /></div>
                <div><div className="text-[10px] uppercase text-brand-textMuted">{t('Perdorur')}</div><Pair v={a.used} /></div>
                <div><div className="text-[10px] uppercase text-brand-textMuted">{t('Para dore')}</div><Pair v={a.cash} className="text-green-400" /></div>
              </div>
              <div className="text-[11px] text-brand-textMuted mt-2">
                {t('Mbetur')}: {a.leftPct.ALL != null ? a.leftPct.ALL + '% L' : '—'} · {a.leftPct.EUR != null ? a.leftPct.EUR + '% €' : '—'} · {t('Kredia e fundit')}: {when(a.lastCreditAt)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-brand-panel border border-[#444] rounded">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-[#444] flex items-center justify-between">
          <span>{t('Historiku i kredive')}</span>
          <button onClick={downloadCsv} disabled={history.length === 0} className="text-[10px] text-brand-yellow disabled:opacity-40">{t('Shkarko CSV')}</button>
        </div>
        {history.length === 0 ? (
          <div className="text-xs text-brand-textMuted p-4 text-center">{t('Asnje kredi e regjistruar.')}</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Data')}</th><th className="p-2">{t('Admini')}</th><th className="p-2">{t('Veprimi')}</th><th className="p-2 text-right">{t('Shuma')}</th><th className="p-2 text-right">{t('Para dore')}</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-[#333]">
                  <td className="p-2 whitespace-nowrap">{when(h.at)}</td>
                  <td className="p-2">{h.adminName}</td>
                  <td className="p-2">{h.kind === 'CREDIT' ? t('Kredi e dhene') : t('Marre mbrapsht')}</td>
                  <td className={'p-2 text-right font-bold whitespace-nowrap ' + (h.kind === 'CREDIT' ? 'text-green-400' : 'text-red-400')}>{h.kind === 'CREDIT' ? '+' : '−'}{h.currency === 'EUR' ? '€' + money(h.amount) : money(h.amount) + ' L'}</td>
                  <td className="p-2 text-right whitespace-nowrap">{h.kind === 'CREDIT' ? (h.currency === 'EUR' ? '€' + money(h.cash) : money(h.cash) + ' L') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminCreditLedger;
