import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const money = (n: number) => Number(n || 0).toLocaleString(getLocale(), { maximumFractionDigits: 2 });
const when = (ms: number) => new Date(ms).toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const amt = (c: 'ALL' | 'EUR', n: number) => (c === 'EUR' ? '€' + money(n) : money(n) + ' L');
const dual = (v: any): api.Dual => ({ ALL: Number(v?.ALL) || 0, EUR: Number(v?.EUR) || 0 });
const Pair: React.FC<{ v: api.Dual; className?: string }> = ({ v, className = '' }) => (
  <div className={`font-bold leading-tight ${className}`}><div>{money(v.ALL)} L</div><div>€{money(v.EUR)}</div></div>
);
const Card: React.FC<{ title: string; v: api.Dual; className?: string; border?: string }> = ({ title, v, className = '', border = 'border-[#444]' }) => (
  <div className={`bg-brand-panel border ${border} rounded p-3`}><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{title}</div><Pair v={v} className={className} /></div>
);

/** Admin (and super admin): the credit given to the agents, what each has left, the winnings paid out of the admin's credit. */
const AgentCredit: React.FC<{ isSuper?: boolean }> = ({ isSuper }) => {
  const { t } = useI18n();
  const [data, setData] = useState<api.AgentCreditLedger | null>(null);
  const [error, setError] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [agentId, setAgentId] = useState('');
  const rangeMs = useMemo(() => ({
    from: from ? new Date(from + 'T00:00:00').getTime() : null,
    to: to ? new Date(to + 'T23:59:59.999').getTime() : null,
  }), [from, to]);
  const hasRange = rangeMs.from != null || rangeMs.to != null;
  const load = useCallback(async () => {
    try { setData(await api.adminFetchAgentCredit(rangeMs, agentId || undefined)); setError(false); }
    catch (e) { console.error('Failed to load agent credit', e); setError(true); }
  }, [rangeMs, agentId]);
  useEffect(() => { load(); }, [load]);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const preset = (k: 'today' | '7d' | 'month' | 'all') => {
    const now = new Date();
    if (k === 'all') { setFrom(''); setTo(''); } else if (k === 'today') { setFrom(ymd(now)); setTo(ymd(now)); }
    else if (k === '7d') { const d = new Date(now); d.setDate(d.getDate() - 6); setFrom(ymd(d)); setTo(ymd(now)); }
    else { setFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(ymd(now)); }
  };
  if (!data) return <div className="text-sm text-brand-textMuted py-10 text-center">{error ? t('Ngarkimi deshtoi.') : t('Duke ngarkuar...')}</div>;
  const my = dual(data.myBalance);
  const wp = data.winPayouts;
  const negative = my.ALL < 0 || my.EUR < 0;
  return (
    <div className="space-y-4">
      <div className="bg-brand-panel border border-[#444] rounded p-3 flex flex-wrap items-end gap-2">
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">{t('Nga data')}<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="input w-40" /></label>
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">{t('Deri ne daten')}<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="input w-40" /></label>
        {([['today', t('Sot')], ['7d', t('7 ditet e fundit')], ['month', t('Ky muaj')], ['all', t('Gjithe koha')]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => preset(k)} className="px-2.5 py-1.5 rounded border border-[#555] text-xs text-brand-yellow hover:bg-white/5">{label}</button>
        ))}
        <label className="text-[10px] text-brand-textMuted uppercase tracking-wide flex flex-col gap-1">{t('Agjenti')}
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="input w-44">
            <option value="">{t('Të gjithë')}</option>
            {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.username})</option>)}
          </select>
        </label>
      </div>

      {!isSuper && (
        <div className={`rounded p-3 border ${negative ? 'bg-red-900/30 border-red-500' : 'bg-brand-panel border-[#444]'}`}>
          <div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredia ime tani')}</div>
          <Pair v={my} className={negative ? 'text-red-400' : ''} />
          {negative && <div className="text-xs text-red-300 mt-1">{t('Kredia ka mbaruar: fitimet e userave u paguan gjithsesi. Kërko kredi nga super admini.')}</div>}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card title={t('Kredi dhënë agjentëve')} v={dual(data.totals.given)} className="text-green-400" />
        <Card title={t('Marrë mbrapsht')} v={dual(data.totals.takenBack)} className="text-orange-300" />
        <Card title={t('Neto te agjentët')} v={dual(data.totals.net)} />
        <Card title={t('Kanë mbetur agjentët')} v={dual(data.totals.remaining)} />
      </div>
      {hasRange && data.periodTotals && (
        <div className="grid grid-cols-2 gap-3 max-w-xl">
          <Card title={t('Dhënë në periudhë')} v={dual(data.periodTotals.given)} className="text-green-400" border="border-yellow-500/60" />
          <Card title={t('Marrë mbrapsht në periudhë')} v={dual(data.periodTotals.takenBack)} className="text-orange-300" />
        </div>
      )}

      <div className="bg-brand-panel border border-[#444] rounded">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-[#444]">{t('Agjentët')}</div>
        {data.agents.length === 0 ? <div className="text-xs text-brand-textMuted p-4 text-center">{t('Asnje agjent.')}</div> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Agjenti')}</th><th className="p-2 text-right">{t('Dhënë')}</th><th className="p-2 text-right">{t('Marrë mbrapsht')}</th><th className="p-2 text-right">{t('Ka mbetur')}</th><th className="p-2">{t('Kredia e fundit')}</th></tr></thead>
            <tbody>{data.agents.map((a) => (
              <tr key={a.id} className="border-t border-[#333] cursor-pointer hover:bg-white/5" onClick={() => setAgentId(agentId === a.id ? '' : a.id)}>
                <td className="p-2 whitespace-nowrap font-bold">{a.name} <span className="text-brand-textMuted font-normal">({a.username})</span></td>
                <td className="p-2 text-right whitespace-nowrap text-green-400">{money(a.given.ALL)} L<br />€{money(a.given.EUR)}</td>
                <td className="p-2 text-right whitespace-nowrap text-orange-300">{money(a.takenBack.ALL)} L<br />€{money(a.takenBack.EUR)}</td>
                <td className="p-2 text-right whitespace-nowrap font-bold">{money(a.remaining.ALL)} L<br />€{money(a.remaining.EUR)}</td>
                <td className="p-2 whitespace-nowrap">{a.lastCreditAt ? when(a.lastCreditAt) : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="bg-brand-panel border border-[#444] rounded">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-[#444]">{t('Historia e kredisë së agjentëve')}</div>
        {data.history.length === 0 ? <div className="text-xs text-brand-textMuted p-4 text-center">{t('Asnje kredi e regjistruar.')}</div> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Data')}</th><th className="p-2">{t('Agjenti')}</th><th className="p-2 text-right">{t('Shuma')}</th></tr></thead>
            <tbody>{data.history.map((h) => (
              <tr key={h.id} className="border-t border-[#333]">
                <td className="p-2 whitespace-nowrap">{when(h.at)}</td>
                <td className="p-2 whitespace-nowrap">{h.agentName} <span className="text-brand-textMuted">({h.agentUsername})</span></td>
                <td className={`p-2 text-right font-bold whitespace-nowrap ${h.kind === 'GIVEN' ? 'text-green-400' : 'text-orange-300'}`}>{h.kind === 'GIVEN' ? '+' : '−'}{amt(h.currency, h.amount)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="bg-brand-panel border border-[#444] rounded">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-[#444]">{t('Kredia e dhënë direkt userave')}</div>
        {(data.directUsers?.list.length ?? 0) === 0 ? <div className="text-xs text-brand-textMuted p-4 text-center">{t('Asnje kredi e dhene direkt userave.')}</div> : (
          <>
            <div className="grid grid-cols-3 gap-3 p-3">
              <Card title={t('Dhënë userave')} v={dual(data.directUsers.totals.given)} className="text-green-400" />
              <Card title={t('Marrë mbrapsht')} v={dual(data.directUsers.totals.takenBack)} className="text-orange-300" />
              <Card title={t('Neto')} v={dual(data.directUsers.totals.net)} />
            </div>
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Useri')}</th><th className="p-2 text-right">{t('Dhënë')}</th><th className="p-2 text-right">{t('Marrë mbrapsht')}</th><th className="p-2 text-right">{t('Ka tani')}</th><th className="p-2">{t('Kredia e fundit')}</th></tr></thead>
              <tbody>{data.directUsers.list.map((u) => (
                <tr key={u.id} className="border-t border-[#333]">
                  <td className="p-2 whitespace-nowrap font-bold">{u.name} <span className="text-brand-textMuted font-normal">({u.username})</span></td>
                  <td className="p-2 text-right whitespace-nowrap text-green-400">{money(u.given.ALL)} L<br />€{money(u.given.EUR)}</td>
                  <td className="p-2 text-right whitespace-nowrap text-orange-300">{money(u.takenBack.ALL)} L<br />€{money(u.takenBack.EUR)}</td>
                  <td className="p-2 text-right whitespace-nowrap font-bold">{money(u.remaining.ALL)} L<br />€{money(u.remaining.EUR)}</td>
                  <td className="p-2 whitespace-nowrap">{u.lastCreditAt ? when(u.lastCreditAt) : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-brand-textMuted border-t border-[#333]">{t('Historia')}</div>
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Data')}</th><th className="p-2">{t('Useri')}</th><th className="p-2 text-right">{t('Shuma')}</th></tr></thead>
              <tbody>{data.directUsers.history.map((h) => (
                <tr key={h.id} className="border-t border-[#333]">
                  <td className="p-2 whitespace-nowrap">{when(h.at)}</td>
                  <td className="p-2 whitespace-nowrap">{h.userName} <span className="text-brand-textMuted">({h.username})</span></td>
                  <td className={`p-2 text-right font-bold whitespace-nowrap ${h.kind === 'GIVEN' ? 'text-green-400' : 'text-orange-300'}`}>{h.kind === 'GIVEN' ? '+' : '−'}{amt(h.currency, h.amount)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </div>

      <div className="bg-brand-panel border border-[#444] rounded">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-[#444]">
          {t('Fitime të paguara userave (zbritur nga kredia e adminit)')}
          {!data.adminPaysWins && <span className="ml-2 normal-case font-normal text-brand-textMuted">{t('— zbritja është e fikur tani')}</span>}
        </div>
        <div className="grid grid-cols-3 gap-3 p-3">
          <Card title={t('Paguar')} v={dual(wp.paid)} className="text-red-300" />
          <Card title={t('Kthyer')} v={dual(wp.reversed)} className="text-green-400" />
          <Card title={t('Neto')} v={dual(wp.net)} />
        </div>
        {wp.history.length === 0 ? <div className="text-xs text-brand-textMuted p-4 text-center border-t border-[#333]">{t('Asnje fitim i zbritur akoma.')}</div> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Data')}</th><th className="p-2">{t('Bileta')}</th><th className="p-2">{t('Useri')}</th><th className="p-2 text-right">{t('Shuma')}</th></tr></thead>
            <tbody>{wp.history.map((h) => (
              <tr key={h.id} className="border-t border-[#333]">
                <td className="p-2 whitespace-nowrap">{when(h.at)}</td>
                <td className="p-2 whitespace-nowrap">{h.ticketNo != null ? '#' + h.ticketNo : '—'}</td>
                <td className="p-2 whitespace-nowrap">{h.username || '—'}</td>
                <td className={`p-2 text-right font-bold whitespace-nowrap ${h.kind === 'PAID' ? 'text-red-300' : 'text-green-400'}`}>{h.kind === 'PAID' ? '−' : '+'}{amt(h.currency, h.amount)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
};
export default AgentCredit;
