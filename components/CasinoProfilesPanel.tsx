import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';

// Super admin: the maths of every casino game. Hit frequency, RTP, bet limits and max win are set per game; the server
// applies them to every round it draws (see server/casinoProfiles.js). Every change is written to the audit log.
type Draft = { hit: string; rtp: string; vol: string; min: string; max: string; maxWin: string };
const KIND_LABEL: Record<api.CasinoProfile['kind'], string> = {
  outcome: 'Hit frequency + RTP', rtp: 'RTP (chances fixed by the rules)', bets: 'Bet limits only (rules fix the payouts)',
};
const toDraft = (p: api.CasinoProfile): Draft => ({
  hit: p.values.hitFrequency !== undefined ? String(+(p.values.hitFrequency * 100).toFixed(2)) : '',
  rtp: p.values.rtp !== undefined ? String(+(p.values.rtp * 100).toFixed(2)) : '',
  vol: p.values.volatility !== undefined ? String(p.values.volatility) : '',
  min: String(p.values.minBet), max: String(p.values.maxBet),
  maxWin: p.values.maxWinMultiplier !== undefined ? String(p.values.maxWinMultiplier) : '',
});
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const Bar: React.FC<{ label: string; v: number }> = ({ label, v }) => (
  <div className="flex items-center gap-2 text-[10px]"><span className="w-14 text-brand-textMuted">{label}</span>
    <div className="h-2 bg-brand-yellow/70 rounded" style={{ width: `${Math.max(1, Math.min(100, v * 100)) * 1.6}px` }} /><span>{(v * 100).toFixed(2)}%</span></div>
);
// What the settings do (computed from the measured payout histogram of the game) next to what the played rounds really did.
const Details: React.FC<{ p: api.CasinoProfile }> = ({ p }) => {
  const pv = p.preview; const m = p.measured;
  return (
    <div className="grid md:grid-cols-2 gap-3 bg-black/30 rounded p-2 text-[11px]">
      <div>
        <div className="font-bold mb-1">Expected with these settings</div>
        {pv ? (<>
          <div>Hit frequency (any payout): <b>{pct(pv.hitFrequency)}</b> · Net-win frequency (payout above the stake): <b>{pct(pv.netWinFrequency)}</b></div>
          <div>RTP (gross paid / staked): <b>{pct(pv.rtp)}</b> · House edge: <b>{pct(pv.houseEdge)}</b> · Volatility σ: <b>{pv.volatilitySd.toFixed(2)}</b> · Max payout: <b>{pv.maxPayout.toFixed(0)}x</b>{pv.capReached ? ' (cap reached)' : ''}</div>
          <div className="mt-1 space-y-0.5">{pv.buckets.map(([l, v]) => <Bar key={l} label={l} v={v} />)}</div>
        </>) : <div className="text-brand-textMuted">{p.kind === 'rtp' ? `RTP ${pct(p.values.rtp ?? 0)} · house edge ${pct(1 - (p.values.rtp ?? 0))} (chances are fixed by the rules, only the payout table is scaled).` : 'Rules fix the payouts of this game; no hit frequency / RTP setting. See the measured results.'}</div>}
      </div>
      {p.rules && <div className="md:col-span-2"><span className="font-bold">Set by the rules of the game: </span><span className="text-brand-textMuted">{p.rules}</span></div>}
      <div>
        <div className="font-bold mb-1">Measured in played rounds</div>
        {m && m.rounds > 0 ? (<>
          <div>{m.rounds} rounds · hit frequency <b>{pct(m.hits / m.rounds)}</b> · net wins <b>{pct(m.net / m.rounds)}</b></div>
          <div>RTP <b>{m.staked > 0 ? pct(m.paid / m.staked) : '–'}</b> · house edge <b>{m.staked > 0 ? pct(1 - m.paid / m.staked) : '–'}</b></div>
          <div className="mt-1 space-y-0.5"><Bar label="≥5x" v={m.x5 / m.rounds} /><Bar label="≥20x" v={m.x20 / m.rounds} /><Bar label="≥100x" v={m.x100 / m.rounds} /></div>
        </>) : <div className="text-brand-textMuted">No finished rounds yet.</div>}
      </div>
    </div>
  );
};

const CasinoProfilesPanel: React.FC = () => {
  const [profiles, setProfiles] = useState<api.CasinoProfile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof api.adminCasinoProfilesAudit>>['entries']>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState('');

  const apply = (list: api.CasinoProfile[]) => { setProfiles(list); setDrafts(Object.fromEntries(list.map((p) => [p.key, toDraft(p)]))); };
  const load = useCallback(async () => {
    try { apply((await api.adminCasinoProfiles()).profiles); setAudit((await api.adminCasinoProfilesAudit()).entries); setError(''); }
    catch (e: any) { setError(e?.message || 'Error'); }
  }, []);
  useEffect(() => { if (open && profiles.length === 0) void load(); }, [open, profiles.length, load]);

  const set = (key: string, field: keyof Draft, value: string) => setDrafts((d) => ({ ...d, [key]: { ...d[key], [field]: value } }));
  const save = async (p: api.CasinoProfile) => {
    const d = drafts[p.key]; const body: Partial<api.CasinoProfileValues> = { minBet: Number(d.min), maxBet: Number(d.max) };
    if (p.kind === 'outcome') { body.hitFrequency = Number(d.hit) / 100; body.volatility = Number(d.vol); body.maxWinMultiplier = Number(d.maxWin); }
    if (p.kind !== 'bets') body.rtp = Number(d.rtp) / 100;
    setBusy(p.key); setError('');
    try { apply((await api.adminSaveCasinoProfile(p.key, body)).profiles); setAudit((await api.adminCasinoProfilesAudit()).entries); }
    catch (e: any) { setError(`${p.label}: ${e?.message || 'Error'}`); } finally { setBusy(''); }
  };
  const reset = async (p: api.CasinoProfile) => {
    setBusy(p.key); setError('');
    try { apply((await api.adminResetCasinoProfile(p.key)).profiles); setAudit((await api.adminCasinoProfilesAudit()).entries); }
    catch (e: any) { setError(`${p.label}: ${e?.message || 'Error'}`); } finally { setBusy(''); }
  };
  const resetStats = async () => {
    if (!window.confirm('Delete YOUR test rounds (players\' rounds are not touched)?')) return;
    try { const r = await api.adminResetCasinoTestStats(); alert(`${r.removed} test rounds removed`); } catch (e: any) { alert(e?.message || 'Error'); }
  };

  const input = 'w-16 bg-black/40 border border-[#555] rounded px-1 py-0.5 text-right text-xs';
  return (
    <div className="bg-brand-panel border border-[#444] rounded p-4">
      <button className="w-full flex justify-between items-center text-left" onClick={() => setOpen(!open)}>
        <span className="text-sm font-bold">Game maths (hit frequency, RTP, limits)</span><span className="text-xs text-brand-textMuted">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <div className="text-[11px] text-brand-textMuted mb-3">
            Hit frequency = share of rounds that pay anything (gross; many of those pay less than the stake). RTP = total paid / total staked. Volatility reshapes the winning payouts (the RTP stays the same). All are set per game and applied by the server before the result is shown;
            nothing depends on the player or on past results. "Natural" columns show how the game behaves without a profile (measured with 1,000,000 rounds).
          </div>
          {error && <div className="text-red-400 text-xs mb-2">{error}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-brand-textMuted text-left">
                <th className="pr-2">Game</th><th className="pr-2">Hit %</th><th className="pr-2">RTP %</th><th className="pr-2" title="1 = flat payouts (few big wins), 5 = the game's own shape (rare, huge big wins)">Volatility 1-5</th><th className="pr-2">Min</th><th className="pr-2">Max</th><th className="pr-2">Max win x</th>
                <th className="pr-2">Natural hit / RTP / volatility</th><th />
              </tr></thead>
              <tbody>
                {profiles.map((p) => { const d = drafts[p.key]; if (!d) return null; return (
                  <React.Fragment key={p.key}>
                  <tr className="border-t border-[#333] align-middle">
                    <td className="py-1 pr-2"><div className="font-bold">{p.label}</div><div className="text-[10px] text-brand-textMuted">{p.group ? `${p.group} · ` : ''}{KIND_LABEL[p.kind]}{p.customised ? ' · changed' : ''}</div></td>
                    <td className="pr-2">{p.kind === 'outcome' ? <input className={input} value={d.hit} onChange={(e) => set(p.key, 'hit', e.target.value)} /> : <span className="text-gray-500">–</span>}</td>
                    <td className="pr-2">{p.kind !== 'bets' ? <input className={input} value={d.rtp} onChange={(e) => set(p.key, 'rtp', e.target.value)} /> : <span className="text-gray-500">–</span>}</td>
                    <td className="pr-2">{p.kind === 'outcome' ? <input className={input} value={d.vol} onChange={(e) => set(p.key, 'vol', e.target.value)} /> : <span className="text-gray-500">–</span>}</td>
                    <td className="pr-2"><input className={input} value={d.min} onChange={(e) => set(p.key, 'min', e.target.value)} /></td>
                    <td className="pr-2"><input className={input} value={d.max} onChange={(e) => set(p.key, 'max', e.target.value)} /></td>
                    <td className="pr-2">{p.kind === 'outcome' ? <input className={input} value={d.maxWin} onChange={(e) => set(p.key, 'maxWin', e.target.value)} /> : <span className="text-gray-500">–</span>}</td>
                    <td className="pr-2 text-[10px] text-brand-textMuted whitespace-nowrap">{p.calibration ? `${pct(p.calibration.pWin)} / ${pct(p.calibration.rtpNat)} / σ ${p.calibration.sd.toFixed(1)}` : '–'}</td>
                    <td className="whitespace-nowrap">
                      <button disabled={busy === p.key} onClick={() => save(p)} className="px-2 py-1 rounded bg-brand-yellow text-black font-bold mr-1 disabled:opacity-40">Save</button>
                      <button onClick={() => setDetail(detail === p.key ? '' : p.key)} className="px-2 py-1 rounded bg-black/40 border border-[#555] mr-1">{detail === p.key ? 'Hide' : 'Stats'}</button>
                      <button disabled={busy === p.key || !p.customised} onClick={() => reset(p)} className="px-2 py-1 rounded bg-black/40 border border-[#555] disabled:opacity-30">Default</button>
                    </td>
                  </tr>
                  {detail === p.key && (<tr><td colSpan={10} className="pb-3"><Details p={p} /></td></tr>)}
                  </React.Fragment>); })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4">
            <div className="text-xs font-bold">Recent changes</div>
            <button onClick={resetStats} className="text-xs px-2 py-1 rounded bg-black/40 border border-[#555]">Reset my test statistics</button>
          </div>
          {audit.length === 0 ? <div className="text-xs text-brand-textMuted mt-1">No changes yet.</div> : (
            <ul className="mt-1 space-y-0.5 text-[11px] text-gray-300">
              {audit.map((a, i) => (<li key={i}>{new Date(a.created_at).toLocaleString()} · {a.actor_username} · {a.action === 'CASINO_PROFILE_RESET' ? 'reset' : 'changed'} <b>{a.target}</b></li>))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
export default CasinoProfilesPanel;
