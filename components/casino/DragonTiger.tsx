import React, { useState } from 'react';
import { casinoDragonTigerDeal } from '../../services/api';
import ChipBet from './ChipBet';
import CoinBurst from './CoinBurst';
import DealerPhoto from './DealerPhoto';
import { CroupierMood } from './Croupier';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
type Bet = 'DRAGON' | 'TIGER' | 'TIE';
type Card = { suit: string; value: string };
const BETS: { id: Bet; label: string; hint: string; cls: string }[] = [
  { id: 'DRAGON', label: '🐉 DRAGON', hint: 'paguan 2x', cls: 'bg-red-900/70 border-red-400/60' },
  { id: 'TIE', label: 'TIE', hint: 'paguan 16x', cls: 'bg-emerald-900/70 border-emerald-400/60' },
  { id: 'TIGER', label: '🐯 TIGER', hint: 'paguan 2x', cls: 'bg-amber-900/70 border-amber-400/60' },
];
const CardFace: React.FC<{ card: Card | null; label: string }> = ({ card, label }) => (
  <div className="text-center">
    <div className="text-xs opacity-70 mb-1">{label}</div>
    <div className={`w-20 h-28 rounded-lg bg-white flex items-center justify-center text-3xl font-bold shadow-xl ${card && (card.suit === '♥' || card.suit === '♦') ? 'text-red-600' : 'text-black'}`} style={{ transform: 'perspective(500px) rotateX(8deg)' }}>
      {card ? `${card.value}${card.suit}` : '?'}
    </div>
  </div>
);

const DragonTiger: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [bet, setBet] = useState<Bet>('DRAGON');
  const [stake, setStake] = useState(25);
  const [cards, setCards] = useState<{ dragon: Card | null; tiger: Card | null }>({ dragon: null, tiger: null });
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<CroupierMood>('idle');
  const [message, setMessage] = useState('Zgjidh anën dhe ndaj letrat');
  const [burst, setBurst] = useState(0);

  const deal = async () => {
    if (busy || stake < 1) return;
    if (userBalance < stake) { setMessage('Insufficient Funds'); return; }
    setBusy(true); setMood('spinning');
    try {
      const r = await casinoDragonTigerDeal(stake, bet);
      setCards({ dragon: r.dragon, tiger: r.tiger }); onSetBalance(r.balance);
      if (r.payout > stake) { setMood('win'); setBurst((n) => n + 1); setMessage(`${r.result} fiton! +${(r.payout - stake).toFixed(2)} L`); }
      else if (r.payout > 0) { setMood('idle'); setMessage(`TIE - gjysma e basti kthehet (${r.payout.toFixed(2)} L)`); }
      else { setMood('lose'); setMessage(`${r.result} fiton - humbe`); }
    } catch (e: any) { setMessage(e?.message || 'Gabim'); setMood('idle'); }
    setBusy(false);
  };

  return (
    <div className="casino-felt flex flex-col items-center justify-between min-h-[600px] rounded-xl p-4 relative overflow-hidden text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      <button onClick={onClose} className="absolute top-4 left-4 text-white/50 hover:text-white font-bold z-10">‹ Exit</button>
      <h2 className="font-bold tracking-widest casino-gold-text mb-1">DRAGON TIGER</h2>
      <DealerPhoto dealer={4} mood={mood} size={96} />
      <div className="flex gap-10 my-3"><CardFace card={cards.dragon} label="DRAGON" /><CardFace card={cards.tiger} label="TIGER" /></div>
      <div key={message} className="text-lg font-bold my-2 win-pop text-center">{message}</div>
      <div className="flex gap-2 mb-3">
        {BETS.map((b) => (
          <button key={b.id} disabled={busy} onClick={() => setBet(b.id)} className={`px-3 py-2 rounded-lg border text-sm font-bold ${b.cls} ${bet === b.id ? 'ring-2 ring-yellow-400' : 'opacity-70'}`}>
            {b.label}<div className="text-[10px] font-normal opacity-80">{b.hint}</div>
          </button>
        ))}
      </div>
      <div className="w-full max-w-lg bg-black/30 p-3 rounded-xl border-t border-white/10 flex items-center justify-between gap-3">
        <div><div className="text-xs opacity-70">Balance</div><div className="font-bold text-yellow-400">{userBalance.toFixed(2)}</div></div>
        <ChipBet stake={stake} onChange={setStake} disabled={busy} />
        <button onClick={deal} disabled={busy} className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-6 py-2 rounded-full disabled:opacity-50">NDAJ</button>
      </div>
    </div>
  );
};
export default DragonTiger;
