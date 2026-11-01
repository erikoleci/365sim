import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';
import CasinoHub from './CasinoHub';

const MODES: { value: api.CasinoMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Fshehur', hint: 'Askush nuk e sheh kazinon' },
  { value: 'super', label: 'Vetëm superadmini', hint: 'Vetëm ti e sheh' },
  { value: 'all', label: 'Të gjithë', hint: 'Lojtarët e shohin dhe luajnë me paratë e tyre' },
];
const money = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Super admin: preview the casino on demo money, choose who may open it, and see what the players played.
interface CasinoAdminProps { userBalance: number; userBalanceEur?: number; onSetBalance: (balance: number, balanceEur?: number) => void }
const CasinoAdmin: React.FC<CasinoAdminProps> = ({ userBalance, userBalanceEur = 0, onSetBalance }) => {
  const [mode, setMode] = useState<api.CasinoMode | null>(null);
  const [report, setReport] = useState<api.CasinoReportRow[]>([]);
  const [error, setError] = useState('');
  const [disabledGames, setDisabledGames] = useState<string[]>([]);
  const [gameKeys, setGameKeys] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const st = await api.adminFetchSettings();
      setMode(st.casinoAccess ?? 'super'); setDisabledGames(st.casinoDisabledGames ?? []); setGameKeys(st.casinoGameKeys ?? []);
      setReport((await api.adminCasinoReport()).rows);
    } catch (e: any) { setError(e?.message || 'Gabim'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const change = async (m: api.CasinoMode) => {
    if (m === mode) return;
    if (m === 'all' && !window.confirm('Kazinoja do t\'u hapet TË GJITHË lojtarëve, që luajnë me paratë e tyre. Vazhdon?')) return;
    try { setMode((await api.adminSetCasinoAccess(m)).casinoAccess); } catch (e: any) { alert(e?.message || 'Gabim'); }
  };

  const toggleGame = async (key: string) => {
    const next = disabledGames.includes(key) ? disabledGames.filter((g) => g !== key) : [...disabledGames, key];
    try { setDisabledGames((await api.adminSetCasinoGames(next)).casinoDisabledGames); } catch (e: any) { alert(e?.message || 'Gabim'); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-brand-panel border border-[#444] rounded p-4">
        <div className="text-sm font-bold mb-2">Kush e sheh kazinon</div>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button key={m.value} onClick={() => change(m.value)}
              className={`px-3 py-2 rounded text-xs text-left border ${mode === m.value ? 'bg-brand-yellow text-black border-brand-yellow font-bold' : 'bg-black/30 text-gray-200 border-[#444] hover:border-brand-yellow/50'}`}>
              <div>{m.label}</div><div className="text-[10px] opacity-70">{m.hint}</div>
            </button>
          ))}
        </div>
        {error && <div className="text-red-400 text-xs mt-2">{error}</div>}
      </div>

      <div className="bg-brand-panel border border-[#444] rounded p-4">
        <div className="text-sm font-bold mb-1">Lojërat që lejohen për lojtarët</div>
        <div className="text-[11px] text-brand-textMuted mb-2">Mbylle një lojë dhe lojtarët nuk futen më në të. Ti prapë e hap, për ta provuar.</div>
        <div className="flex flex-wrap gap-2">
          {gameKeys.map((g) => (
            <button key={g} onClick={() => toggleGame(g)}
              className={`px-3 py-1.5 rounded text-xs border ${disabledGames.includes(g) ? 'bg-red-900/40 text-red-300 border-red-700' : 'bg-green-900/30 text-green-300 border-green-700'}`}>
              {g} · {disabledGames.includes(g) ? 'MBYLLUR' : 'HAPUR'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-brand-panel border border-[#444] rounded p-4">
        <div className="flex justify-between items-center mb-2"><div className="text-sm font-bold">Çfarë është luajtur</div><button className="text-xs text-brand-textMuted hover:text-white" onClick={load}>↻</button></div>
        {report.length === 0 ? <div className="text-xs text-brand-textMuted">Ende asnjë raund nga lojtarët.</div> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-brand-textMuted text-left"><th>Loja</th><th>Monedha</th><th className="text-right">Raunde</th><th className="text-right">Vënë</th><th className="text-right">Paguar</th><th className="text-right">Rezultati i shtëpisë</th></tr></thead>
            <tbody>{report.map((r) => (
              <tr key={r.game + r.currency} className="border-t border-[#333]">
                <td className="py-1">{r.game}</td><td>{r.currency === 'EUR' ? '€' : 'L'}</td><td className="text-right">{r.rounds}</td>
                <td className="text-right">{money(r.staked)}</td><td className="text-right">{money(r.paid)}</td>
                <td className={`text-right font-bold ${r.houseResult >= 0 ? 'text-green-400' : 'text-red-400'}`}>{money(r.houseResult)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>

      <CasinoHub userBalance={userBalance} userBalanceEur={userBalanceEur} onSetBalance={onSetBalance} showAllGames />
    </div>
  );
};

export default CasinoAdmin;
