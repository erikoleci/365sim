import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';

// Super admin: every live action code (VC) the feed sent, rarest first, with the match / score / clock it was seen
// in and the server time. A penalty is rare, so it sits near the top; find it by match name and time.
const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '-');

const VcCodesPanel: React.FC = () => {
  const [data, setData] = useState<api.VcCodesReport | null>(null);
  const [labels, setLabels] = useState<api.ProviderLabelsReport | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api.adminFetchVcCodes()); setError(''); }
    catch (e: any) { setError(e?.message || 'Gabim'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadLabels = async () => {
    setBusy(true);
    try { setLabels(await api.adminFetchProviderLabels()); setError(''); }
    catch (e: any) { setError(e?.message || 'Gabim'); }
    finally { setBusy(false); }
  };

  const q = filter.trim().toLowerCase();
  const rows = (data?.unlabelled ?? []).filter((r) => !q || `${r.example?.match ?? ''} ${r.code}`.toLowerCase().includes(q));

  return (
    <div className="bg-brand-panel border border-[#444] rounded p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="input w-64" placeholder="Kërko ndeshje ose kod (p.sh. San Marcos)" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="text-xs px-3 py-2 rounded bg-green-700 hover:bg-green-600 font-bold" onClick={load} disabled={busy}>Rifresko</button>
        <button className="text-xs px-3 py-2 rounded bg-[#333] hover:bg-[#444] font-bold" onClick={loadLabels} disabled={busy}>Emrat nga provider-i</button>
      </div>
      <div className="text-[11px] text-brand-textMuted mb-3">
        Kodet pa emër, nga më të rrallët. Penalti ka numër të vogël. Kërko ndeshjen ose shiko &quot;Parë së fundi&quot; afër orës së penaltit. Pastrohet kur riniset serveri.
      </div>
      {error && <div className="text-sm text-red-400 mb-2">{error}</div>}
      {!data ? <div className="text-sm text-brand-textMuted">Duke ngarkuar...</div> : (
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-brand-textMuted text-left border-b border-[#444]">
            <th className="py-1.5 pr-2">Kodi</th><th className="py-1.5 pr-2">Herë</th><th className="py-1.5 pr-2">Shtëpi/Udhëtim</th>
            <th className="py-1.5 pr-2">Ndeshja (shembull)</th><th className="py-1.5 pr-2">Rezultati</th><th className="py-1.5 pr-2">Minuta</th>
            <th className="py-1.5 pr-2">Parë së pari</th><th className="py-1.5 pr-2">Parë së fundi</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-[#333]">
                <td className="py-1.5 pr-2 font-bold text-brand-yellow">{r.code}</td>
                <td className="py-1.5 pr-2">{r.count}</td>
                <td className="py-1.5 pr-2">{r.home}/{r.away}</td>
                <td className="py-1.5 pr-2">{r.example?.match ?? '-'}</td>
                <td className="py-1.5 pr-2">{r.example?.score ?? '-'}</td>
                <td className="py-1.5 pr-2">{r.example?.t ?? '-'}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{fmtTime(r.firstSeen)}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{fmtTime(r.lastSeen)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-brand-textMuted">Asnjë kod.</td></tr>}
          </tbody>
        </table></div>
      )}
      {labels && (
        <div className="mt-5">
          <div className="text-xs font-bold mb-2">Emrat që gjeti te faqja e provider-it ({labels.matches.length})</div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {labels.matches.map((m, i) => (
              <div key={i} className="bg-brand-bg/40 rounded p-2 text-[11px]">
                <div className="text-brand-yellow font-bold">{m.word}{m.pairs.length > 0 && ' → ' + m.pairs.map((p) => `${p.code}: ${p.text}`).join(' | ')}</div>
                <div className="text-brand-textMuted break-all">{m.around}</div>
              </div>
            ))}
            {labels.matches.length === 0 && <div className="text-xs text-brand-textMuted">Asgjë.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default VcCodesPanel;
