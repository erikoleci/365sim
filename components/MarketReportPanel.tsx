import React, { useEffect, useRef, useState } from 'react';
import * as api from '../services/api';

/** Admin tab: markets the system cannot settle by itself, as text that is easy to copy on a phone. */
const MarketReportPanel: React.FC = () => {
  const [report, setReport] = useState<api.AdminMarketCoverage | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.adminFetchMarketCoverage().then(setReport).catch((e) => setError(e?.message || 'Nuk u ngarkua'));
  }, []);

  const copy = async () => {
    const text = report?.text || '';
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { box.current?.focus(); box.current?.select(); setCopied(false); } // fallback: select, then long-press > Copy
    setTimeout(() => setCopied(false), 2500);
  };

  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (!report) return <div className="text-brand-textMuted text-sm">Loading...</div>;
  const s = report.summary;
  return (
    <div className="space-y-4">
      <div className="text-sm text-brand-text">
        Tregje gjithsej: <b>{s.markets}</b> · me rregull: <b>{s.autoSettled}</b> · pa rregull: <b className="text-brand-yellow">{s.withoutRule}</b>
        {s.pendingLegsWithoutRule > 0 && <> · bileta hapur pa rregull: <b className="text-brand-yellow">{s.pendingLegsWithoutRule}</b></>}
      </div>
      <button onClick={copy} className="bg-brand-yellow text-black font-bold px-4 min-h-[44px] rounded">
        {copied ? 'U kopjua ✓' : 'Kopjo raportin'}
      </button>
      <textarea
        ref={box}
        readOnly
        value={report.text}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full h-[60vh] bg-brand-bg text-brand-text text-xs font-mono border border-brand-divider rounded p-2"
      />
    </div>
  );
};

export default MarketReportPanel;
