import React, { useEffect, useRef, useState } from 'react';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoHoldWinInfo, casinoHoldWinPlay, HoldWinRound } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtCoin = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n % 1 ? n.toFixed(2) : String(n));

// HOLD & WIN: land 6+ coins to lock them in; every new coin resets 3 respins. Fill all 15 cells for the 50x board bonus.
const HoldWin: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [info, setInfo] = useState<{ cols: number; rows: number; minTrigger: number; lives: number; fullBoardBonus: number } | null>(null);
  const [stake, setStake] = useState(100);
  const [board, setBoard] = useState<number[]>(Array(15).fill(0));
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [lives, setLives] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('Land 6 or more coins to start the bonus');
  const [payout, setPayout] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const alive = useRef(true);
  const locked = useRef(100);
  useEffect(() => { casinoHoldWinInfo().then(setInfo).catch(() => {}); return () => { alive.current = false; }; }, []);

  const cols = info?.cols ?? 5;
  const play = async () => {
    if (busy) return;
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setBusy(true); setPayout(0); setBoard(Array(15).fill(0)); setLives(0); setMsg('Coins are landing…'); sfx.spin();
    locked.current = stake;
    try {
      const r: HoldWinRound = await casinoHoldWinPlay(stake);
      const b = Array(15).fill(0);
      for (const c of r.start) { b[c.cell] = c.value; if (!alive.current) return; setBoard([...b]); setFresh(new Set([c.cell])); sfx.click(); await sleep(260); }
      if (!r.bonus) {
        setMsg(`Only ${r.start.length} coin${r.start.length === 1 ? '' : 's'} — you need ${info?.minTrigger ?? 6} for the bonus`);
        onSetBalance(r.balance); setFresh(new Set()); return;
      }
      setMsg('HOLD & WIN! Respins…'); sfx.win(true); setLives(info?.lives ?? 3); await sleep(900);
      for (const rs of r.respins) {
        if (!alive.current) return;
        await sleep(650);
        for (const c of rs.landed) b[c.cell] = c.value;
        setBoard([...b]); setFresh(new Set(rs.landed.map((c) => c.cell))); setLives(rs.lives);
        if (rs.landed.length) sfx.win(false); else sfx.stop();
      }
      setFresh(new Set()); await sleep(500);
      setPayout(r.payout); onSetBalance(r.balance);
      setMsg(r.full ? `FULL BOARD! +${info?.fullBoardBonus ?? 50}x bonus` : 'Bonus complete');
      if (r.payout > 0) { sfx.win(true); setBurst((n) => n + 1); const tier = winTier(r.payout, locked.current); if (tier > 0) setBigWin({ tier: tier as 1 | 2 | 3, amount: r.payout }); }
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { if (alive.current) { setBusy(false); setLives(0); } }
  };

  return (
    <div className="max-w-2xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} disabled={busy} className="text-sm text-gray-300 hover:text-white disabled:opacity-40">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">HOLD &amp; WIN</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>
      <div className="bulbs w-full" />
      <div className="rounded-2xl border-4 border-yellow-600/70 p-3 cabinet-glow" style={{ background: 'radial-gradient(circle at 50% 0%, #3b0764, #0c0a1f 75%)' }}>
        <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {board.map((v, i) => (
            <div key={i} className={`aspect-square rounded-xl flex items-center justify-center border ${v ? 'border-yellow-300/70 bg-black/40' : 'border-white/10 bg-black/50'}`}>
              {v > 0 && (
                <div className={`w-[84%] h-[84%] rounded-full flex flex-col items-center justify-center text-black font-black ${fresh.has(i) ? 'tumble-drop' : ''}`}
                  style={{ background: 'radial-gradient(circle at 32% 28%, #fff7c2, #facc15 45%, #b45309)', boxShadow: '0 4px 8px rgba(0,0,0,.6), inset 0 -3px 6px rgba(0,0,0,.3), 0 0 14px rgba(250,204,21,.6)' }}>
                  <span className="text-[11px] sm:text-sm leading-none">{fmtCoin(Math.round(v * locked.current * 100) / 100)}</span>
                  <span className="text-[8px] sm:text-[10px] opacity-70 leading-none mt-0.5">{fmtCoin(v)}x</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3 px-1 min-h-[34px]">
          <div className="flex gap-1.5" aria-label="Respins left">{Array.from({ length: info?.lives ?? 3 }).map((_, i) => <span key={i} className={`w-3.5 h-3.5 rounded-full border ${i < lives ? 'bg-yellow-300 border-yellow-100 shadow-[0_0_8px_#fde047]' : 'bg-black/50 border-white/20'}`} />)}</div>
          <div className="text-sm font-bold text-gray-100 text-right">{payout > 0 ? <span className="text-brand-yellow win-pop inline-block text-lg">Won <CountUp value={payout} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>
        </div>
      </div>
      <div className="mt-4"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={busy} /></div>
      <button onClick={play} disabled={busy || userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50 active:scale-[.98]">{busy ? '…' : `PLAY · ${stake} L`}</button>
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · RTP ~96% · each coin shows its prize · max win {2000}x</div>
    </div>
  );
};
export default HoldWin;
