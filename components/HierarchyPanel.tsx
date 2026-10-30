import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const money = (n: number) => Number(n || 0).toLocaleString(getLocale(), { maximumFractionDigits: 2 });
const Bal: React.FC<{ lek: number; eur: number }> = ({ lek, eur }) => (
  <span className="whitespace-nowrap text-brand-yellow font-bold">{money(lek)} L <span className="text-brand-textMuted font-normal">·</span> €{money(eur)}</span>
);

// Super admin only: who owns whom (admin -> agents -> users) and a way to hand an agent (with all his
// users) or a single user over to another admin.
const HierarchyPanel: React.FC = () => {
  const { t } = useI18n();
  const [tree, setTree] = useState<api.Hierarchy | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try { setTree(await api.adminFetchHierarchy()); setError(''); }
    catch (e: any) { setError(e?.message || t('Veprimi deshtoi')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  // Where an account can go: "Admin X" (direct) or "Admin X → Agent Y" (users only).
  const targets = useMemo(() => {
    const list: { value: string; label: string; agent: boolean }[] = [{ value: '|', label: t('Pa pronar'), agent: false }];
    for (const a of tree?.admins ?? []) {
      list.push({ value: `${a.id}|`, label: `${a.name} (@${a.username})`, agent: false });
      for (const ag of a.agents) list.push({ value: `${a.id}|${ag.id}`, label: `${a.name} → ${ag.name}`, agent: true });
    }
    return list;
  }, [tree, t]);

  const move = async (id: string, name: string, value: string, isAgent: boolean) => {
    const [adminId, agentId] = value.split('|');
    const dest = targets.find((x) => x.value === value)?.label || '';
    const what = isAgent ? t('agjentin {name} me gjithë userat e tij', { name }) : t('userin {name}', { name });
    if (!window.confirm(t('Të kalohet {what} te {dest}?', { what, dest }))) return;
    setBusy(id);
    try { await api.adminMoveAccount(id, adminId || null, agentId || null); await load(); }
    catch (e: any) { alert(e?.message || t('Veprimi deshtoi')); }
    finally { setBusy(null); }
  };

  const assignAll = async (adminId: string) => {
    if (!adminId) return;
    const name = tree?.admins.find((a) => a.id === adminId)?.name || '';
    if (!window.confirm(t('Të kalohen TË GJITHË agjentët dhe userat pa pronar te {name}?', { name }))) return;
    setBusy('all');
    try { await api.adminAssignUnowned(adminId); await load(); }
    catch (e: any) { alert(e?.message || t('Veprimi deshtoi')); }
    finally { setBusy(null); }
  };

  const mover = (id: string, name: string, isAgent: boolean) => (
    <select
      className="input text-xs w-44"
      disabled={busy === id}
      value=""
      onChange={(e) => { if (e.target.value !== '__') move(id, name, e.target.value, isAgent); }}
    >
      <option value="__">{t('Kalo te…')}</option>
      {targets.filter((x) => !(isAgent && x.agent)).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
    </select>
  );

  const match = (u: api.HierarchyUser) => !filter || `${u.name} ${u.username}`.toLowerCase().includes(filter.toLowerCase());

  const userRow = (u: api.HierarchyUser) => (
    <div key={u.id} className="flex items-center justify-between gap-2 py-1 text-xs border-t border-[#333]">
      <div className="min-w-0 truncate">
        <span className={u.isActive ? '' : 'line-through text-brand-textMuted'}>{u.name}</span> <span className="text-brand-textMuted">@{u.username}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0"><Bal lek={u.balance} eur={u.balanceEur} />{mover(u.id, u.name, false)}</div>
    </div>
  );

  const branch = (b: api.HierarchyBranch) => {
    const direct = b.directUsers.filter(match);
    const empty = b.agents.length === 0 && b.directUsers.length === 0;
    return (
      <div className="pl-3 border-l border-[#444] ml-1 mt-2 space-y-2">
        {b.agents.filter((ag) => match(ag) || ag.users.some(match)).map((ag) => (
          <div key={ag.id} className="bg-brand-bg/40 rounded p-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0 truncate"><span className="text-[10px] uppercase text-brand-textMuted mr-1">{t('Agjent')}</span><b>{ag.name}</b> <span className="text-brand-textMuted">@{ag.username}</span> · {ag.users.length} {t('usera')}</div>
              <div className="flex items-center gap-2 shrink-0"><Bal lek={ag.balance} eur={ag.balanceEur} />{mover(ag.id, ag.name, true)}</div>
            </div>
            {ag.users.filter((u) => match(u) || match(ag)).map(userRow)}
          </div>
        ))}
        {direct.length > 0 && (
          <div className="bg-brand-bg/40 rounded p-2">
            <div className="text-[10px] uppercase text-brand-textMuted mb-1">{t('Usera pa agjent')}</div>
            {direct.map(userRow)}
          </div>
        )}
        {empty && <div className="text-xs text-brand-textMuted">{t('Bosh.')}</div>}
      </div>
    );
  };

  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (!tree) return <div className="text-sm text-brand-textMuted">{t('Duke ngarkuar...')}</div>;

  const unownedCount = tree.unowned.agents.length + tree.unowned.directUsers.length;
  return (
    <div className="bg-brand-panel border border-[#444] rounded p-4">
      <div className="flex items-center gap-2 mb-4">
        <input className="input w-60" placeholder={t('Kërko agjent ose user…')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="text-xs text-brand-textMuted hover:text-white" onClick={load}>↻</button>
      </div>
      <div className="space-y-3">
        {tree.admins.map((a) => {
          const nUsers = a.agents.reduce((n, ag) => n + ag.users.length, 0) + a.directUsers.length;
          const isOpen = open[a.id] ?? !!filter;
          return (
            <div key={a.id} className="border border-[#444] rounded p-3">
              <button className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpen((p) => ({ ...p, [a.id]: !isOpen }))}>
                <div className="text-sm"><span className="text-brand-yellow mr-1">{isOpen ? '▾' : '▸'}</span><b>{a.name}</b> <span className="text-brand-textMuted text-xs">@{a.username}</span>
                  <span className="text-xs text-brand-textMuted ml-2">{a.agents.length} {t('agjente')} · {nUsers} {t('usera')}</span></div>
                <Bal lek={a.balance} eur={a.balanceEur} />
              </button>
              {isOpen && branch(a)}
            </div>
          );
        })}
        {unownedCount > 0 && (
          <div className="border border-dashed border-[#666] rounded p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <div className="text-sm font-bold">{t('Pa pronar (asnjë admin)')} ({tree.unowned.agents.length} {t('agjente')} · {tree.unowned.directUsers.length + tree.unowned.agents.reduce((n, ag) => n + ag.users.length, 0)} {t('usera')})</div>
              <select className="input text-xs w-56" value="" onChange={(e) => assignAll(e.target.value)}>
                <option value="">{t('Kalo të gjithë te…')}</option>
                {tree.admins.map((a) => <option key={a.id} value={a.id}>{a.name} (@{a.username})</option>)}
              </select>
            </div>
            {branch(tree.unowned)}
          </div>
        )}
        {tree.admins.length === 0 && unownedCount === 0 && <div className="text-sm text-brand-textMuted">{t("S'ka admina.")}</div>}
      </div>
    </div>
  );
};

export default HierarchyPanel;
