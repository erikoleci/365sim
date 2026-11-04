import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';

// Super admin: the raw frames the live feed sent every time something other than the clock changed (goal, card,
// corner, penalty, a player's name ...), newest first. The fields that CHANGED are highlighted with their previous
// value, so a penalty shows up as the field that moved at that minute. Refreshes by itself every 5 s.
const FeedFramesPanel: React.FC = () => {
  const [frames, setFrames] = useState<api.FeedFrame[]>([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setFrames((await api.adminFetchFeedFrames()).frames); setError(''); }
    catch (e: any) { setError(e?.message || 'Gabim'); }
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const q = filter.trim().toLowerCase();
  const rows = frames.filter((f) => !q || `${f.eid} ${f.changed.join(' ')} ${Object.values(f.frame).join(' ')}`.toLowerCase().includes(q));

  return (
    <div className="bg-brand-panel border border-[#444] rounded p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input className="input w-64" placeholder="Kërko (ekip, fushë, vlerë)" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="text-xs px-3 py-2 rounded bg-green-700 hover:bg-green-600 font-bold" onClick={load}>Rifresko</button>
        <span className="text-[11px] text-brand-textMuted">{rows.length} / {frames.length} frame-e (rifreskohet vetë, fshihet kur rinis serveri)</span>
      </div>
      <div className="text-[11px] text-brand-textMuted mb-3">Kur ndodh një penallti, gol ose karton, gjej minutën këtu dhe shiko cila fushë ndryshoi. Kopjo frame-in dhe ma dërgo.</div>
      {error && <div className="text-red-400 text-xs mb-2">{error}</div>}
      {rows.length === 0 && !error && <div className="text-center text-brand-textMuted text-xs py-8">Asnjë ndryshim ende. Frame-et shfaqen kur një ndeshje live ka një ngjarje.</div>}
      <div className="space-y-1.5">
        {rows.map((f) => {
          const key = `${f.at}-${f.eid}`;
          const teams = [f.frame.H, f.frame.A].filter(Boolean).join(' - ');
          return (
            <div key={key} className="rounded bg-black/25 p-2 text-xs">
              <button className="w-full text-left" onClick={() => setOpen(open === key ? null : key)}>
                <span className="text-brand-textMuted">{new Date(f.at).toLocaleTimeString()}</span>{' '}
                <span className="font-bold text-white">{teams || `EID ${f.eid}`}</span>{' '}
                {f.changed.map((c) => (
                  <span key={c} className="inline-block mr-1.5 px-1.5 py-0.5 rounded bg-yellow-500/20 text-brand-yellow font-mono">{c}: {f.from[c] ?? '–'} → {f.frame[c]}</span>
                ))}
              </button>
              {open === key && (
                <pre className="mt-2 p-2 rounded bg-black/40 text-[11px] text-white/80 whitespace-pre-wrap break-all">{JSON.stringify(f.frame, null, 1)}</pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FeedFramesPanel;
