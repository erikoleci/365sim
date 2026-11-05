import React, { useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoChainStart, casinoChainPick, casinoChainCashout, casinoTowerLevels, ChainCfg } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
type Cell = 'safe' | 'trap' | 'trapHit' | null;
const LABELS: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

// GOLD TOWER: climb floor by floor, choose a door on each. Hidden traps lurk behind some doors.
const Tower: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [levels, setLevels] = useState<Record<string, ChainCfg & { step: number }>>({});
  const [level, setLevel] = useState('medium');
  const [stake, setStake] = useState(100);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [cfg, setCfg] = useState<ChainCfg | null>(null);
  const [rows, setRows] = useState<Cell[][]>([]);   // floors climbed so far (bottom first)
  const [total, setTotal] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('Pick a difficulty and start climbing');
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const locked = useRef(0);
  useEffect(() => { casinoTowerLevels().then((r) => setLevels(r.levels)).catch(() => {}); }, []);

  const active = cfg ?? levels[level] ?? { doors: 3, traps: 1, maxSteps: 10, step: 1.45 };
  const step = (levels[level]?.step ?? 1.45);
  const playing = !!roundId;
  const climbed = rows.length;

  const win = (p: number) => { setWinAmt(p); setBurst((b) => b + 1); sfx.win(true); const t = winTier(p, locked.current); if (t > 0) setBigWin({ tier: t as 1 | 2 | 3, amount: p }); };
  const start = async () => {
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setBusy(true);
    try {
      const r = await casinoChainStart('tower', stake, level);
      locked.current = stake; onSetBalance(r.balance); setRoundId(r.roundId); setCfg(r.cfg); setRows([]); setTotal(1); setWinAmt(0); setMsg('Choose a door'); sfx.click();
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };
  const pick = async (door: number) => {
    if (!roundId || !cfg || busy) return;
    setBusy(true);
    try {
      const r = await casinoChainPick('tower', roundId, door);
      const row: Cell[] = Array.from({ length: cfg.doors }, (_, i) => (r.traps.includes(i) ? (i === door ? 'trapHit' : 'trap') : i === door ? 'safe' : null));
      setRows((x) => [...x, row]);
      if (!r.safe) { setRoundId(null); setTotal(1); setMsg('A trap! The tower collapses…'); sfx.stop(); if (r.balance !== undefined) onSetBalance(r.balance); }
      else {
        sfx.win(false); setTotal(r.total ?? total);
        if (r.finished) { setRoundId(null); if (r.balance !== undefined) onSetBalance(r.balance); win(r.payout ?? 0); setMsg('You reached the top!'); } else setMsg('Safe! Keep climbing or cash out');
      }
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };
  const cashout = async () => {
    if (!roundId || busy || total <= 1) return;
    setBusy(true);
    try { const r = await casinoChainCashout('tower', roundId); onSetBalance(r.balance); setRoundId(null); win(r.payout); setMsg(`Cashed out at ${r.multiplier.toFixed(2)}x`); }
    catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };

  const floors = active.maxSteps;
  const nextMult = Math.floor(total * (playing ? (levels[level]?.step ?? step) : step) * 100) / 100;
  return (
    <div className="max-w-md mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} disabled={playing} className="text-sm text-gray-300 hover:text-white disabled:opacity-40">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">GOLD TOWER</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>

      {!playing && (
        <div className="flex justify-center gap-1.5 mb-3">
          {Object.keys(levels).map((k) => <button key={k} disabled={busy} onClick={() => setLevel(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${level === k ? 'bg-brand-yellow text-black border-brand-yellow' : 'bg-black/40 text-gray-200 border-white/15'}`}>{LABELS[k] || k}<div className="text-[9px] font-normal opacity-80">{levels[k].doors} doors · {levels[k].traps} trap{levels[k].traps > 1 ? 's' : ''}</div></button>)}
        </div>
      )}

      <div className="relative rounded-2xl p-3 border-2 border-yellow-600/60 cabinet-glow" style={{ background: 'linear-gradient(#1c1917, #451a03)' }}>
        <div className="text-center text-2xl mb-1" aria-hidden>🏆</div>
        <div className="flex flex-col-reverse gap-1.5">
          {Array.from({ length: floors }).map((_, f) => {
            const row = rows[f]; const current = f === climbed && playing;
            const m = Math.floor(Math.pow(step, f + 1) * 100) / 100;
            return (
              <div key={f} className={`flex items-center gap-2 rounded-lg p-1.5 ${current ? 'bg-yellow-400/15 ring-1 ring-yellow-300' : 'bg-black/30'}`}>
                <div className={`w-14 text-[11px] font-black tabular-nums text-center ${row ? 'text-green-300' : 'text-yellow-200/70'}`}>{m.toFixed(2)}x</div>
                <div className="flex-1 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${active.doors}, minmax(0,1fr))` }}>
                  {Array.from({ length: active.doors }).map((__, d) => {
                    const c = row?.[d];
                    return (
                      <button key={d} disabled={!current || busy} onClick={() => pick(d)} aria-label={`Floor ${f + 1} door ${d + 1}`}
                        className={`h-9 rounded-md border text-lg font-black transition ${c === 'safe' ? 'bg-green-600 border-green-300' : c === 'trapHit' ? 'bg-red-700 border-red-300 tumble-win' : c === 'trap' ? 'bg-red-950/70 border-red-800 opacity-80' : current ? 'bg-gradient-to-b from-amber-500 to-amber-800 border-amber-200 hover:brightness-125 animate-pulse' : 'bg-gradient-to-b from-stone-600 to-stone-800 border-stone-500 opacity-70'}`}>
                        {c === 'safe' ? '🚪' : c === 'trapHit' || c === 'trap' ? '💀' : current ? '?' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-sm font-bold min-h-[24px]">{winAmt > 0 && !playing ? <span className="text-brand-yellow win-pop inline-block text-lg">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>
        <div className="text-right"><div className="text-2xl font-black text-brand-yellow tabular-nums">{total.toFixed(2)}x</div>{playing && <div className="text-[10px] text-gray-300">next → {nextMult.toFixed(2)}x</div>}</div>
      </div>

      {playing ? (
        <button onClick={cashout} disabled={busy || total <= 1} className="mt-2 w-full py-3 rounded-xl font-black text-lg bg-gradient-to-b from-amber-300 to-orange-600 text-black disabled:opacity-40 shadow-lg">CASH OUT · {(locked.current * total).toFixed(2)} L</button>
      ) : (
        <>
          <div className="mt-2"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={busy} /></div>
          <button onClick={start} disabled={busy || userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">CLIMB · {stake} L</button>
        </>
      )}
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · traps are drawn by the server when you pick · 97% fair odds per floor</div>
    </div>
  );
};
export default Tower;
