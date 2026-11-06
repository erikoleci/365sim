import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const CACHE_KEY = 'cachedCreditLedger2'; // 2: the shape gained settled / owed / testGiven (an older cache would crash the page)
const dual = (v: any): api.Dual => ({ ALL: Number(v?.ALL) || 0, EUR: Number(v?.EUR) || 0 });
// Whatever is in the cache (or the server answers) is filled up with safe defaults before it is drawn.
const normPeriod = (p: any): api.CreditPeriod => ({ given: dual(p?.given), real: dual(p?.real), test: dual(p?.test), takenBack: dual(p?.takenBack), cash: dual(p?.cash), settled: dual(p?.settled), credits: Number(p?.credits) || 0 });
const normalize = (l: any): api.CreditLedger | null => {
  if (!l || !Array.isArray(l.admins) || !l.totals) return null;
  return {
    ...l,
    admins: l.admins.map((a: any) => ({ ...a, period: a.period ? normPeriod(a.period) : undefined, given: dual(a.given), takenBack: dual(a.takenBack), net: dual(a.net), cash: dual(a.cash), used: dual(a.used), remaining: dual(a.remaining), settled: dual(a.settled), owed: dual(a.owed), testGiven: dual(a.testGiven), leftPct: a.leftPct || { ALL: null, EUR: null } })),
    totals: { given: dual(l.totals.given), takenBack: dual(l.totals.takenBack), net: dual(l.totals.net), cash: dual(l.totals.cash), remaining: dual(l.totals.remaining), settled: dual(l.totals.settled), owed: dual(l.totals.owed), testGiven: dual(l.totals.testGiven) },
    periodTotals: l.periodTotals ? normPeriod(l.periodTotals) : undefined,
    history: Array.isArray(l.history) ? l.history : [],
  };
};
const readCache = (): api.CreditLedger | null => {
  try { localStorage.removeItem('cachedCreditLedger'); return normalize(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')); } catch { return null; }
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
  const [isTest, setIsTest] = useState(false);
  const [when_, setWhen] = useState('');
  const [recordOnly, setRecordOnly] = useState(false);
  // "From this date to that date": local days (yyyy-mm-dd). Empty = all time.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rangeMs = useMemo(() => ({
    from: from ? new Date(from + 'T00:00:00').getTime() : null,
    to: to ? new Date(to + 'T23:59:59.999').getTime() : null,
  }), [from, to]);
  const hasRange = rangeMs.from != null || rangeMs.to != null;
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const preset = (k: 'today' | '7d' | 'month' | 'all') => {
    const now = new Date();
    if (k === 'all') { setFrom(''); setTo(''); return; }
    if (k === 'today') { setFrom(ymd(now)); setTo(ymd(now)); return; }
    if (k === '7d') { const d = new Date(now); d.setDate(d.getDate() - 6); setFrom(ymd(d)); setTo(ymd(now)); return; }
    setFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(ymd(now));
  };
  const [pay, setPay] = useState<Record<string, { lek: string; eur: string }>>({});

  const load = useCallback(async () => {
    try {
      const data = await api.adminFetchCreditLedger(undefined, rangeMs);
      const n = normalize(data);
      if (!n) throw new Error('bad ledger');
      setLedger(n);
      setError(false);
      if (!rangeMs.from && !rangeMs.to) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(n)); } catch { /* storage unavailable */ } }
    } catch (e) { console.error('Failed to load credit ledger', e); setError(true); }
  }, [rangeMs]);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const a = Number(lek) || 0;
    const b = Number(eur) || 0;
    if (!adminId || (a <= 0 && b <= 0) || a < 0 || b < 0) return;
    const admin = ledger?.admins.find((x) => x.id === adminId);
    const rate = isTest ? 0 : Math.round((ledger?.feeRate ?? 0.1) * 100);
    const msg = `${admin?.name || ''}: ${a > 0 ? money(a) + ' L' : ''}${a > 0 && b > 0 ? ' + ' : ''}${b > 0 ? '€' + money(b) : ''}\n` +
      t('Para dore ({rate}%): {cash}', { rate: String(rate), cash: `${a > 0 ? money(a * rate / 100) + ' L' : ''}${a > 0 && b > 0 ? ' + ' : ''}${b > 0 ? '€' + money(b * rate / 100) : ''}` });
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const atMs = when_ ? new Date(when_).getTime() : undefined;
      if (when_ && !Number.isFinite(atMs)) { alert(t('Data nuk eshte e sakte')); setBusy(false); return; }
      await api.adminCreditAdmin(adminId, a, b, isTest, { at: atMs, recordOnly });
      setLek(''); setEur(''); setIsTest(false); setWhen(''); setRecordOnly(false);
      await load();
    } catch (err: any) {
      alert(err.message || t('Veprimi deshtoi'));
    } finally { setBusy(false); }
  };

  const settle = async (a: api.CreditLedger['admins'][number]) => {
    const p = pay[a.id] || { lek: '', eur: '' };
    const l = Number(p.lek) || 0; const e = Number(p.eur) || 0;
    if (l < 0 || e < 0 || (l <= 0 && e <= 0)) return;
    const txt = `${a.name}: ${l > 0 ? money(l) + ' L' : ''}${l > 0 && e > 0 ? ' + ' : ''}${e > 0 ? '€' + money(e) : ''}`;
    if (!window.confirm(t('Shlyer {x}?', { x: txt }))) return;
    setBusy(true);
    try { await api.adminSettleCredit(a.id, l, e); setPay((m) => ({ ...m, [a.id]: { lek: '', eur: '' } })); await load(); }
    catch (err: any) { alert(err.message || t('Veprimi deshtoi')); } finally { setBusy(false); }
  };
  const [dateEdit, setDateEdit] = useState<{ id: number; val: string } | null>(null);
  const toLocalInput = (ms: number) => { const d = new Date(ms); const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const saveDate = async () => {
    if (!dateEdit) return;
    const ms = new Date(dateEdit.val).getTime();
    if (!Number.isFinite(ms)) { alert(t('Data nuk eshte e sakte')); return; }
    try { await api.adminEditCredit(dateEdit.id, { at: ms }); setDateEdit(null); await load(); } catch (err: any) { alert(err.message || t('Veprimi deshtoi')); }
  };
  const toggleTest = async (h: api.CreditLedger['history'][number]) => {
    if (typeof h.id !== 'number') return;
    try { await api.adminEditCredit(h.id, { isTest: !h.isTest }); await load(); } catch (err: any) { alert(err.message || t('Veprimi deshtoi')); }
  };
  const editDate = async (h: api.CreditLedger['history'][number]) => {
    if (typeof h.id !== 'number') return;
    const d = new Date(h.at); const pad = (n: number) => String(n).padStart(2, '0');
    const cur = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const v = window.prompt(t('Data dhe ora (VVVV-MM-DD HH:MM)'), cur);
    if (!v) return;
    const ms = new Date(v.trim().replace(' ', 'T')).getTime();
    if (!Number.isFinite(ms)) { alert(t('Data nuk eshte e sakte')); return; }
    try { await api.adminEditCredit(h.id, { at: ms }); await load(); } catch (err: any) { alert(err.message || t('Veprimi deshtoi')); }
  };
  const delSettlement = async (h: api.CreditLedger['history'][number]) => {
    if (!h.settlementId || !window.confirm(t('Fshi kete shlyerje?'))) return;
    try { await api.adminDeleteSettlement(h.settlementId); await load(); } catch (err: any) { alert(err.message || t('Veprimi deshtoi')); }
  };

  // The book as a spreadsheet (opens in Excel): date, admin, action, currency, amount and the cash kept.
  const downloadCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Data', 'Admini', 'Veprimi', 'Monedha', 'Shuma', 'Para dore', 'Perqindja'].map(esc).join(',')];
    for (const h of history) {
      lines.push([
        new Date(h.at).toISOString().replace('T', ' ').slice(0, 19), h.adminName, h.kind === 'CREDIT' ? (h.isTest ? 'Kredi test' : 'Kredi') : h.kind === 'SETTLEMENT' ? 'Shlyer' : 'Marre mbrapsht',
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
      <div className="bg-brand-panel border border-[#444] rounded p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">{t('Nga data')}<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="input w-40" /></label>
          <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">{t('Deri ne daten')}<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="input w-40" /></label>
          {([['today', t('Sot')], ['7d', t('7 ditet e fundit')], ['month', t('Ky muaj')], ['all', t('Gjithe koha')]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => preset(k)} className="px-2.5 py-1.5 rounded border border-[#555] text-xs text-brand-yellow hover:bg-white/5">{label}</button>
          ))}
        </div>
        {hasRange && ledger.periodTotals && (
          <div>
            <div className="text-xs text-brand-textMuted mb-2">{t('Kredia e dhene ne periudhen e zgjedhur')}: <b className="text-white">{from ? new Date(from + 'T00:00:00').toLocaleDateString(getLocale()) : '…'} – {to ? new Date(to + 'T00:00:00').toLocaleDateString(getLocale()) : '…'}</b></div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded border border-[#444] p-2"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredi reale')}</div><Pair v={ledger.periodTotals.real} className="text-green-400" /></div>
              <div className="rounded border border-[#444] p-2"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Test / falas (nuk llogaritet)')}</div><Pair v={ledger.periodTotals.test} className="text-gray-300" /></div>
              <div className="rounded border border-[#444] p-2"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Para dore ({rate}%)', { rate: String(feePct) })}</div><Pair v={ledger.periodTotals.cash} className="text-green-400" /></div>
              <div className="rounded border border-[#444] p-2"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Marre mbrapsht')}</div><Pair v={ledger.periodTotals.takenBack} /></div>
              <div className="rounded border border-[#444] p-2"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Shlyer')}</div><Pair v={ledger.periodTotals.settled} /></div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredi e dhene')}</div><Pair v={ledger.totals.given} /></div>
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Marre mbrapsht')}</div><Pair v={ledger.totals.takenBack} /></div>
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Mbetur te adminet')}</div><Pair v={ledger.totals.remaining} /></div>
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Para dore ({rate}%)', { rate: String(feePct) })}</div><Pair v={ledger.totals.cash} className="text-green-400" /></div>
        <div className="bg-brand-panel border border-yellow-500/60 rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Per t\'u shlyer')}</div><Pair v={ledger.totals.owed} className="text-brand-yellow" /></div>
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
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">
          {t('Data dhe ora kur e dhe')}
          <input type="datetime-local" value={when_} onChange={(e) => setWhen(e.target.value)} className="input w-52" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-brand-textMuted pb-2 cursor-pointer" title={t('Kredia u dha me pare: shkruhet vetem ne liber, balanca e adminit nuk ndryshon')}><input type="checkbox" checked={recordOnly} onChange={(e) => setRecordOnly(e.target.checked)} />{t('Vetem ne liber (balanca pa ndryshim)')}</label>
        <label className="flex items-center gap-1.5 text-xs text-brand-textMuted pb-2 cursor-pointer"><input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />{t('Test / falas (0%)')}</label>
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
              {hasRange && a.period && (
                <div className="text-[11px] mt-2 pt-2 border-t border-[#333] text-brand-textMuted">
                  {t('Ne periudhe')}: <b className="text-green-400">{money(a.period.real.ALL)} L · €{money(a.period.real.EUR)}</b>
                  {(a.period.test.ALL > 0 || a.period.test.EUR > 0) && <> · {t('Test')}: {money(a.period.test.ALL)} L · €{money(a.period.test.EUR)}</>}
                  {' '}· {t('Para dore')}: {money(a.period.cash.ALL)} L · €{money(a.period.cash.EUR)}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs mt-2 pt-2 border-t border-[#333]">
                <div><div className="text-[10px] uppercase text-brand-textMuted">{t('Shlyer')}</div><Pair v={a.settled} /></div>
                <div><div className="text-[10px] uppercase text-brand-textMuted">{t('Per t\'u shlyer')}</div><Pair v={a.owed} className={a.owed.ALL > 0 || a.owed.EUR > 0 ? 'text-brand-yellow' : 'text-white'} /></div>
              </div>
              {(a.testGiven.ALL > 0 || a.testGiven.EUR > 0) && <div className="text-[11px] text-brand-textMuted mt-1">{t('Test / falas (nuk llogaritet)')}: {a.testGiven.ALL > 0 ? money(a.testGiven.ALL) + ' L ' : ''}{a.testGiven.EUR > 0 ? '€' + money(a.testGiven.EUR) : ''}</div>}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <input type="number" min="0" inputMode="decimal" placeholder="L" value={pay[a.id]?.lek ?? ''} onChange={(e) => setPay((m) => ({ ...m, [a.id]: { lek: e.target.value, eur: m[a.id]?.eur ?? '' } }))} className="input w-24" />
                <input type="number" min="0" inputMode="decimal" placeholder="€" value={pay[a.id]?.eur ?? ''} onChange={(e) => setPay((m) => ({ ...m, [a.id]: { lek: m[a.id]?.lek ?? '', eur: e.target.value } }))} className="input w-20" />
                <button onClick={() => settle(a)} disabled={busy} className="px-3 py-1.5 rounded bg-green-600 text-white text-xs font-bold uppercase disabled:opacity-50">{t('Shlyer')}</button>
              </div>
              {filter === a.id && (
                <div className="mt-2 pt-2 border-t border-[#333] text-xs max-h-72 overflow-y-auto">
                  {(ledger.history.filter((h) => h.adminId === a.id)).length === 0 ? <div className="text-brand-textMuted">{t('Asnje kredi e regjistruar.')}</div> : ledger.history.filter((h) => h.adminId === a.id).map((h) => (
                    <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-1 border-b border-[#333] last:border-0">
                      <span className="whitespace-nowrap text-brand-textMuted">{when(h.at)}</span>
                      <span className="flex-1 truncate">{h.kind === 'CREDIT' ? t('Kredi e dhene') : h.kind === 'SETTLEMENT' ? t('Shlyer') : t('Marre mbrapsht')}{h.isTest ? ' · ' + t('Test') : ''}</span>
                      <span className={'font-bold whitespace-nowrap ' + (h.kind === 'CREDIT' ? 'text-green-400' : h.kind === 'SETTLEMENT' ? 'text-sky-300' : 'text-red-400')}>{h.kind === 'CREDIT' ? '+' : '−'}{h.currency === 'EUR' ? '€' + money(h.amount) : money(h.amount) + ' L'}</span>
                      {h.kind === 'CREDIT' && typeof h.id === 'number' && (
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <button onClick={() => toggleTest(h)} className={'px-1.5 py-0.5 rounded text-[10px] font-bold ' + (h.isTest ? 'bg-green-600 text-white' : 'bg-gray-600 text-white')}>{h.isTest ? t('Bej real') : t('Bej test')}</button>
                          <button onClick={() => setDateEdit({ id: h.id as number, val: toLocalInput(h.at) })} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-brand-yellow text-black">{t('Data')}</button>
                        </span>
                      )}
                      {dateEdit && dateEdit.id === h.id && (
                        <div className="basis-full flex items-center gap-2 pt-1">
                          <input type="datetime-local" value={dateEdit.val} onChange={(e) => setDateEdit({ id: dateEdit.id, val: e.target.value })} className="bg-[#111] border border-[#444] rounded px-2 py-1 text-xs text-white" />
                          <button onClick={saveDate} className="px-2 py-1 rounded bg-green-600 text-white text-xs font-bold">{t('Ruaj')}</button>
                          <button onClick={() => setDateEdit(null)} className="px-2 py-1 rounded bg-gray-600 text-white text-xs">{t('Anulo')}</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
            <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Data')}</th><th className="p-2">{t('Admini')}</th><th className="p-2">{t('Veprimi')}</th><th className="p-2 text-right">{t('Shuma')}</th><th className="p-2 text-right">{t('Para dore')}</th><th className="p-2"></th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-[#333]">
                  <td className="p-2 whitespace-nowrap">{when(h.at)}</td>
                  <td className="p-2">{h.adminName}</td>
                  <td className="p-2">{h.kind === 'CREDIT' ? <>{t('Kredi e dhene')}{h.isTest && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-600 text-[10px] font-bold uppercase">{t('Test')}</span>}</> : h.kind === 'SETTLEMENT' ? <span className="text-sky-300 font-bold">{t('Shlyer')}</span> : t('Marre mbrapsht')}</td>
                  <td className={'p-2 text-right font-bold whitespace-nowrap ' + (h.kind === 'CREDIT' ? 'text-green-400' : h.kind === 'SETTLEMENT' ? 'text-sky-300' : 'text-red-400')}>{h.kind === 'CREDIT' ? '+' : '−'}{h.currency === 'EUR' ? '€' + money(h.amount) : money(h.amount) + ' L'}</td>
                  <td className="p-2 text-right whitespace-nowrap">{h.kind === 'CREDIT' ? (h.currency === 'EUR' ? '€' + money(h.cash) : money(h.cash) + ' L') : '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap text-[10px] uppercase">
                    {h.kind === 'CREDIT' && <><button onClick={() => toggleTest(h)} className="text-brand-yellow mr-2">{h.isTest ? t('Bej real') : t('Bej test')}</button><button onClick={() => editDate(h)} className="text-brand-yellow">{t('Data')}</button></>}
                    {h.kind === 'SETTLEMENT' && <button onClick={() => delSettlement(h)} className="text-red-400">{t('Fshi')}</button>}
                  </td>
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
