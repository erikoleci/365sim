import React, { useState } from 'react';
import { casinoMinesStart, casinoMinesReveal, casinoMinesCashout } from '../../services/api';
import ChipBet from './ChipBet';
import CoinBurst from './CoinBurst';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }

const Mines: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [stake, setStake] = useState(25);
  const [mineCount, setMineCount] = useState(3);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [opened, setOpened] = useState<number[]>([]);
  const [mines, setMines] = useState<number[]>([]);
  const [hit, setHit] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [next, setNext] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Zgjidh numrin e minave dhe nis');
  const [burst, setBurst] = useState(0);
  const playing = roundId !== null;

  const start = async () => {
    if (busy || stake < 1) return;
    if (userBalance < stake) { setMessage('Insufficient Funds'); return; }
    setBusy(true);
    try {
      const r = await casinoMinesStart(stake, mineCount);
      setRoundId(r.roundId); setOpened([]); setMines([]); setHit(null); setMultiplier(1); setNext(r.nextMultiplier);
      onSetBalance(r.balance); setMessage('Hap një kuti');
    } catch (e: any) { setMessage(e?.message || 'Gabim'); }
    setBusy(false);
  };

  const reveal = async (i: number) => {
    if (!roundId || busy || opened.includes(i)) return;
    setBusy(true);
    try {
      const r = await casinoMinesReveal(roundId, i);
      if (!r.safe) { setHit(i); setMines(r.mines || []); setRoundId(null); setMessage('BOMBË! Humbe'); if (r.balance !== undefined) onSetBalance(r.balance); }
      else {
        setOpened((o) => [...o, i]); setMultiplier(r.multiplier || 1); setNext(r.nextMultiplier || 0);
        if (r.finished) { setMines(r.mines || []); setRoundId(null); setBurst((n) => n + 1); setMessage(`Pastrove tavolinën! ${r.payout?.toFixed(2)} L`); if (r.balance !== undefined) onSetBalance(r.balance); }
      }
    } catch (e: any) { setMessage(e?.message || 'Gabim'); }
    setBusy(false);
  };

  const cashout = async () => {
    if (!roundId || busy || opened.length === 0) return;
    setBusy(true);
    try {
      const r = await casinoMinesCashout(roundId);
      setMines(r.mines); setRoundId(null); onSetBalance(r.balance); setBurst((n) => n + 1);
      setMessage(`Mblodhe ${r.payout.toFixed(2)} L (${r.multiplier}x)`);
    } catch (e: any) { setMessage(e?.message || 'Gabim'); }
    setBusy(false);
  };

  return (
    <div className="casino-felt flex flex-col items-center min-h-[600px] rounded-xl p-4 relative overflow-hidden text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      <button onClick={onClose} className="absolute top-4 left-4 text-white/50 hover:text-white font-bold z-10">‹ Exit</button>
      <h2 className="font-bold tracking-widest casino-gold-text mb-2">MINES</h2>
      <div className="text-sm mb-2">Shumëzuesi: <b className="text-yellow-400">{multiplier.toFixed(2)}x</b>{playing && next > 0 && <span className="opacity-70"> · tjetra {next.toFixed(2)}x</span>}</div>
      <div className="grid grid-cols-5 gap-2 mb-3" style={{ perspective: 700, transform: 'rotateX(12deg)' }}>
        {Array.from({ length: 25 }, (_, i) => {
          const isOpen = opened.includes(i), isMine = mines.includes(i), isHit = hit === i;
          return (
            <button key={i} disabled={!playing || busy || isOpen} onClick={() => reveal(i)}
              className={`w-14 h-14 sm:w-16 sm:h-16 rounded-lg text-2xl font-bold border transition-transform hover:-translate-y-0.5 ${isHit ? 'bg-red-700 border-red-300' : isMine ? 'bg-red-900/60 border-red-500/50' : isOpen ? 'bg-emerald-600 border-emerald-300' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}>
              {isHit || isMine ? '💣' : isOpen ? '💎' : ''}
            </button>
          );
        })}
      </div>
      <div key={message} className="text-lg font-bold my-2 win-pop">{message}</div>
      <div className="w-full max-w-lg bg-black/30 p-3 rounded-xl border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div><div className="text-xs opacity-70">Balance</div><div className="font-bold text-yellow-400">{userBalance.toFixed(2)}</div></div>
        {!playing ? (
          <>
            <ChipBet stake={stake} onChange={setStake} disabled={busy} />
            <div className="text-xs"><div className="opacity-70 mb-1">Mina</div>
              <select value={mineCount} onChange={(e) => setMineCount(Number(e.target.value))} className="bg-black/50 border border-white/20 rounded px-2 py-1">{[1, 3, 5, 10, 15, 20, 24].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
            <button onClick={start} disabled={busy} className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-6 py-2 rounded-full disabled:opacity-50">NIS</button>
          </>
        ) : (
          <button onClick={cashout} disabled={busy || opened.length === 0} className="bg-green-600 hover:bg-green-500 text-white font-bold px-6 py-2 rounded-full disabled:opacity-40">MBLIDH {(stake * multiplier).toFixed(2)}</button>
        )}
      </div>
    </div>
  );
};
export default Mines;
