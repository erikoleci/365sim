import React, { useState } from 'react';
import { casinoDiceRoll } from '../../services/api';
import Die3D from './Die3D';
import Croupier, { CroupierMood } from './Croupier';
import { ChipStack } from './Chip';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';

interface DiceProps {
  onSetBalance: (balance: number) => void;
  userBalance: number;
  onClose: () => void;
}

type Bet = 'UNDER' | 'SEVEN' | 'OVER';
const BETS: { id: Bet; label: string; hint: string; cls: string }[] = [
  { id: 'UNDER', label: 'UNDER 7', hint: 'shuma 2 - 6', cls: 'bg-sky-900/70 border-sky-400/60' },
  { id: 'SEVEN', label: 'SEVEN', hint: 'shuma 7', cls: 'bg-emerald-900/70 border-emerald-400/60' },
  { id: 'OVER', label: 'OVER 7', hint: 'shuma 8 - 12', cls: 'bg-rose-900/70 border-rose-400/60' },
];

const Dice: React.FC<DiceProps> = ({ onSetBalance, userBalance, onClose }) => {
  const [dice, setDice] = useState<[number, number]>([1, 1]);
  const [rollKey, setRollKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bet, setBet] = useState<Bet | null>(null);
  const [stake, setStake] = useState(50);
  const [message, setMessage] = useState('Zgjidh një basti dhe hidh zaret');
  const [won, setWon] = useState<boolean | null>(null);
  const [winAmount, setWinAmount] = useState(0);
  const [burst, setBurst] = useState(0);
  const [sum, setSum] = useState<number | null>(null);
  const mood: CroupierMood = busy ? 'spinning' : won === null ? 'idle' : won ? 'win' : 'lose';

  const roll = async () => {
    if (busy) return;
    if (!bet) { setMessage('Zgjidh fillimisht një bast!'); return; }
    if (userBalance < stake) { setMessage('Gjendje e pamjaftueshme'); return; }
    setBusy(true); setWon(null); setWinAmount(0); setSum(null); setMessage('Zaret po rrotullohen...');
    try {
      const r = await casinoDiceRoll(stake, bet);
      setDice(r.dice);
      setRollKey((k) => k + 1);
      await new Promise((res) => setTimeout(res, 1700)); // the dice tumble (see casino.css)
      onSetBalance(r.balance);
      setSum(r.sum);
      const win = r.payout > 0;
      setWon(win); setWinAmount(r.payout);
      if (win) { setBurst((n) => n + 1); setMessage(`FITOVE! ${r.payout.toFixed(2)} L`); } else setMessage(`Humbe - doli ${r.sum}`);
    } catch (e: any) {
      setMessage(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="casino-felt relative min-h-[560px] rounded-2xl p-6 text-white overflow-hidden flex flex-col items-center">
      {burst > 0 && <CoinBurst key={burst} />}
      <button onClick={onClose} className="absolute top-4 left-4 text-sm text-gray-200 hover:text-white font-semibold">‹ Lobby</button>
      <h2 className="casino-gold-text text-4xl font-extrabold tracking-widest" style={{ fontFamily: 'Georgia, serif' }}>DICE</h2>
      <Croupier mood={mood} size={110} />

      <div className="flex items-end justify-center gap-14 h-40 mt-2">
        <Die3D value={dice[0]} rollKey={rollKey} delay={0} />
        <Die3D value={dice[1]} rollKey={rollKey} delay={120} />
      </div>
      <div className="h-10 mt-2 text-3xl font-extrabold tabular-nums">{sum !== null ? <span key={rollKey} className="win-pop inline-block">{sum}</span> : ''}</div>
      <div className="h-7 text-lg font-semibold text-center">{message}</div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-xl mt-4">
        {BETS.map((b) => (
          <button key={b.id} disabled={busy} onClick={() => { setBet(b.id); setMessage(`Bast ${stake} L mbi ${b.label}`); }}
            className={`rounded-xl border-2 py-4 transition-all ${b.cls} ${bet === b.id ? 'ring-4 ring-yellow-300 scale-105' : 'opacity-85 hover:opacity-100'}`}>
            <div className="font-extrabold">{b.label}</div>
            <div className="text-xs text-gray-200">{b.hint}</div>
            {bet === b.id && <div className="flex justify-center mt-2"><ChipStack value={stake} count={3} size={30} /></div>}
          </button>
        ))}
      </div>

      <div className="mt-5 w-full max-w-xl flex items-center justify-between gap-4 bg-black/40 rounded-xl p-4">
        <div>
          <div className="text-xs text-gray-300 uppercase">Balance</div>
          <div className="text-xl font-bold text-yellow-300 tabular-nums">{userBalance.toFixed(2)}</div>
          {winAmount > 0 && <div className="text-xs text-green-300">+<CountUp value={winAmount} format={(n) => n.toFixed(2)} /></div>}
        </div>
        <div className="flex items-center gap-2">
          <button disabled={busy} onClick={() => setStake((s) => Math.max(5, s - 10))} className="w-8 h-8 rounded bg-black/50">-</button>
          <span className="w-12 text-center font-bold">{stake}</span>
          <button disabled={busy} onClick={() => setStake((s) => s + 10)} className="w-8 h-8 rounded bg-black/50">+</button>
        </div>
        <button onClick={roll} disabled={busy} className="px-8 py-3 rounded-full font-extrabold text-black bg-gradient-to-b from-yellow-300 to-yellow-500 disabled:opacity-50 active:scale-95 transition-transform">{busy ? '...' : 'HIDH'}</button>
      </div>
    </div>
  );
};

export default Dice;
