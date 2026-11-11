import React, { useCallback, useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoLiveKenoState, casinoLiveKenoBet, LiveKenoState } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }

// LIVE KENO: one draw of 10 balls (1-40) for the whole table every 30 s. Pick up to 8 numbers, up to a few tickets per draw.
const LiveKeno: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [st, setSt] = useState<LiveKenoState | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [stake, setStake] = useState(100);
  const [left, setLeft] = useState(0);
  const [shown, setShown] = useState<number[]>([]);
  const [msg, setMsg] = useState('Pick 1 to 8 numbers');
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const offset = useRef(0); const alive = useRef(true); const stRef = useRef<LiveKenoState | null>(null);
  const lastRound = useRef<number | null>(null); const drawnFor = useRef<number | null>(null); const pending = useRef<LiveKenoState['settled']>([]);
  const timers = useRef<number[]>([]);

  const refresh = useCallback(async () => {
    try {
      const s = await casinoLiveKenoState();
      if (!alive.current) return;
      offset.current = s.serverNow - Date.now(); stRef.current = s; setSt(s); onSetBalance(s.balance);
      if (s.settled.length) pending.current = [...pending.current, ...s.settled];
      if (lastRound.current !== null && lastRound.current !== s.round) { setShown([]); setWinAmt(0); setMsg('Pick 1 to 8 numbers'); setPicks([]); }
      lastRound.current = s.round;
      if (s.phase === 'draw' && s.drawn && drawnFor.current !== s.round) {
        drawnFor.current = s.round; setMsg('Drawing the balls…'); sfx.spin();
        s.drawn.forEach((n, i) => { timers.current.push(window.setTimeout(() => { if (!alive.current) return; setShown((x) => [...x, n]); sfx.click(); }, 400 + i * 450)); });
        timers.current.push(window.setTimeout(() => {
          if (!alive.current) return;
          const mine = pending.current; pending.current = [];
          const staked = mine.reduce((a, x) => a + x.staked, 0); const paid = mine.reduce((a, x) => a + x.payout, 0);
          if (paid > 0) { setWinAmt(paid); setBurst((b) => b + 1); sfx.win(true); setMsg('You won!'); const t = winTier(paid, staked); if (t > 0) setBigWin({ tier: t as 1 | 2 | 3, amount: paid }); }
          else setMsg(staked > 0 ? 'No win this draw' : 'Draw complete');
        }, 400 + s.drawn.length * 450 + 300));
      }
    } catch { /* retry */ }
  }, [onSetBalance]);

  useEffect(() => { alive.current = true; refresh(); const t = window.setInterval(refresh, 1500); return () => { alive.current = false; window.clearInterval(t); timers.current.forEach(window.clearTimeout); }; }, [refresh]);
  useEffect(() => { const t = window.setInterval(() => { const s = stRef.current; if (!s) return; const el = (Date.now() + offset.current) % s.cycleMs; setLeft(el < s.betMs ? s.betMs - el : s.cycleMs - el); }, 250); return () => window.clearInterval(t); }, []);

  const betting = st?.phase === 'betting' && (Date.now() + offset.current) % (st?.cycleMs ?? 30000) < (st?.betMs ?? 20000);
  const toggle = (n: number) => { if (!betting) return; sfx.click(); setPicks((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= 8 ? p : [...p, n])); };
  const place = async () => {
    if (!st || !betting || picks.length === 0) return;
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    try { const r = await casinoLiveKenoBet(st.round, stake, picks); onSetBalance(r.balance); setPicks([]); setMsg('Ticket placed — good luck!'); refresh(); } catch (e: any) { setMsg(e?.message || 'Error'); }
  };
  const mine = new Set((st?.tickets ?? []).flatMap((t) => t.picks));
  const pct = st ? Math.min(1, left / (st.phase === 'betting' ? st.betMs : st.cycleMs - st.betMs)) : 0;

  return (
    <div className="max-w-xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} className="text-sm text-gray-300 hover:text-white">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />LIVE KENO</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-300 mb-1"><span>Draw #{st?.round ?? '…'}{st?.simulatedPlayers && st.tablePlayers ? ` · ${st.tablePlayers} players` : ''}</span><span className="font-bold tabular-nums">{betting ? `Bets close in ${Math.ceil(left / 1000)}s` : 'Drawing'}</span></div>
      <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mb-3"><div className={`h-full ${betting ? 'bg-yellow-300' : 'bg-red-500'}`} style={{ width: `${pct * 100}%`, transition: 'width .25s linear' }} /></div>

      <div className="rounded-2xl border-2 border-cyan-500/40 p-3 cabinet-glow" style={{ background: 'radial-gradient(circle at 50% 0%, #164e63, #0b1220 75%)' }}>
        <div className="grid grid-cols-8 gap-1.5">
          {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => {
            const hit = shown.includes(n); const sel = picks.includes(n); const placed = mine.has(n);
            return (
              <button key={n} disabled={!betting} onClick={() => toggle(n)} className={`aspect-square rounded-full text-sm font-black border-2 transition ${hit && (placed || sel) ? 'bg-yellow-300 text-black border-yellow-100 scale-110 shadow-[0_0_14px_#fde047]' : hit ? 'bg-cyan-400 text-black border-cyan-100 scale-105' : sel ? 'bg-green-600 border-green-300' : placed ? 'bg-green-900/70 border-green-500' : 'bg-black/40 border-white/15 hover:bg-white/10'} disabled:cursor-default`}>{n}</button>
            );
          })}
        </div>
        <div className="text-center font-bold mt-3 min-h-[26px]">{winAmt > 0 ? <span className="text-brand-yellow win-pop inline-block text-lg">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>
      </div>

      <div className="mt-3"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={!betting} /></div>
      <div className="flex gap-2 mt-2">
        <button disabled={!betting || picks.length === 0} onClick={() => setPicks([])} className="px-4 rounded-xl border border-white/20 text-gray-200 disabled:opacity-40">Clear</button>
        <button onClick={place} disabled={!betting || picks.length === 0 || userBalance < stake} className="flex-1 py-3.5 rounded-xl font-black text-lg bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">{picks.length ? `BUY TICKET · ${picks.length} numbers · ${stake} L` : 'PICK YOUR NUMBERS'}</button>
      </div>
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · 10 balls from 40 · max 5000 L per draw · credit only{st?.simulatedPlayers ? ' · includes simulated players' : ''}</div>
    </div>
  );
};
export default LiveKeno;
