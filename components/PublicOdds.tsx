import React, { useEffect, useMemo, useState } from 'react';
import * as api from '../services/api';
import type { Match } from '../types';

// Public, read-only odds board (365sim.uk/koeficientet): no sign-in, no slip, nothing to click except "Hyr".
const isResultMarket = (name: string) => /^(rezultati final|rezultati i ndeshjes|1x2|rezultati|fitues|match result|full time result)$/i
  .test(name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim());
const pick = (m: Match) => {
  const mk = m.markets.find((x) => isResultMarket(x.name)) || m.markets.find((x) => x.options.length === 3 && x.options.some((o) => /^(x|barazim|draw)$/i.test(o.name)));
  if (!mk) return null;
  const by = (re: RegExp, i: number) => mk.options.find((o) => re.test(o.name.trim())) || mk.options[i];
  return [by(/^1$|home|shtepi/i, 0), by(/^(x|draw|barazim)$/i, 1), by(/^2$|away|mik/i, 2)];
};
const kickoff = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const PublicOdds: React.FC = () => {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [liveOnly, setLiveOnly] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let on = true;
    const run = async () => {
      try {
        const [all, live] = await Promise.all([api.fetchMatches(), api.fetchLiveMatches().catch(() => ({ matches: [] as Match[] }))]);
        if (!on) return;
        const liveById = new Map(live.matches.map((m) => [m.id, m]));
        setMatches(all.matches.map((m) => (liveById.has(m.id) ? { ...m, ...liveById.get(m.id)!, markets: liveById.get(m.id)!.markets?.length ? liveById.get(m.id)!.markets : m.markets } : m)));
        if (all.leagueNames) setNames(all.leagueNames);
      } catch { if (on) setMatches((p) => p ?? []); }
    };
    run();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') run(); }, 20000);
    return () => { on = false; window.clearInterval(t); };
  }, []);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (matches || []).filter((m) => (!liveOnly || m.isLive || m.status === 'LIVE') && m.status !== 'FINISHED'
      && (!needle || `${m.homeTeam} ${m.awayTeam}`.toLowerCase().includes(needle)));
    const map = new Map<string, Match[]>();
    for (const m of list.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))) {
      const k = names[m.league] || m.league;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return [...map.entries()];
  }, [matches, names, liveOnly, q]);

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans">
      <header className="sticky top-0 z-10 bg-brand-header border-b border-brand-divider px-3 py-2 flex items-center gap-2">
        <div className="text-lg font-extrabold text-white">bet<span className="text-brand-yellow">365</span>sim</div>
        <span className="text-xs text-brand-textMuted hidden sm:inline">Koeficientet</span>
        <a href="/hyr" className="ml-auto bg-brand-yellow text-brand-bg px-4 py-1.5 rounded font-bold text-sm">Hyr</a>
      </header>
      <div className="max-w-3xl mx-auto p-3 space-y-3">
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko ekip…" className="flex-1 rounded-lg border border-brand-divider bg-brand-panel text-white placeholder:text-brand-textMuted px-3 py-2 text-sm outline-none focus:border-brand-yellow" />
          <button onClick={() => setLiveOnly((v) => !v)} className={'px-3 rounded-lg text-sm font-bold border ' + (liveOnly ? 'bg-brand-yellow text-brand-bg border-brand-yellow' : 'border-brand-divider text-brand-textMuted')}>Live</button>
        </div>
        {matches == null && <div className="text-center text-brand-textMuted text-sm py-10">Duke ngarkuar…</div>}
        {matches && groups.length === 0 && <div className="text-center text-brand-textMuted text-sm py-10">Nuk ka ndeshje.</div>}
        {groups.map(([league, list]) => (
          <section key={league} className="bg-brand-panel rounded-lg overflow-hidden border border-brand-divider">
            <h2 className="px-3 py-1.5 text-xs font-bold text-brand-yellow bg-brand-header/60 truncate">{league}</h2>
            {list.map((m) => {
              const o = pick(m); const live = m.isLive || m.status === 'LIVE';
              return (
                <div key={m.id} className="px-3 py-2 border-t border-brand-divider flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-brand-textMuted">{live ? <b className="text-green-400">LIVE {m.currentMinute || ''}{m.score ? ` · ${m.score.home}-${m.score.away}` : ''}</b> : kickoff(m.startTime)}</div>
                    <div className="text-sm text-white truncate">{m.homeTeam}</div>
                    <div className="text-sm text-white truncate">{m.awayTeam}</div>
                  </div>
                  {o ? o.map((x, i) => (
                    <div key={i} className="w-14 text-center bg-brand-bg rounded py-1.5">
                      <div className="text-[10px] text-brand-textMuted">{['1', 'X', '2'][i]}</div>
                      <div className="text-sm font-bold text-brand-yellow">{x && !x.suspended && x.odds > 1 ? x.odds.toFixed(2) : '—'}</div>
                    </div>
                  )) : <span className="text-[11px] text-brand-textMuted">—</span>}
                </div>
              );
            })}
          </section>
        ))}
        <p className="text-center text-[11px] text-brand-textMuted py-4">Për të luajtur duhet të hysh me llogarinë tënde.</p>
      </div>
    </div>
  );
};
export default PublicOdds;
