import React, { useRef, useState } from 'react';
import StakeInput from './StakeInput';
import PlayingCard from './PlayingCard';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoHiLoStart, casinoHiLoGuess, casinoHiLoCashout, HiLoCard, HiLoOptions } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }

const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const face = (c: HiLoCard) => ({ suit: SUITS[c.suit], value: VALUES[c.rank - 1] });

// HI-LO: guess higher or lower than the current card. Ties lose. Every correct guess compounds the multiplier; cash out any time.
const HiLo: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [stake, setStake] = useState(100);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [cards, setCards] = useState<HiLoCard[]>([]);
  const [total, setTotal] = useState(1);
  const [opts, setOpts] = useState<HiLoOptions>({ higher: 0, lower: 0 });
  const [steps, setSteps] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('Place your stake and deal');
  const [result, setResult] = useState<'win' | 'lose' | null>(null);
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const lockedStake = useRef(0);

  const playing = !!roundId;
  const celebrate = (payout: number) => {
    setWinAmt(payout); setResult('win'); sfx.win(payout >= lockedStake.current * 3); setBurst((b) => b + 1);
    const tier = winTier(payout, lockedStake.current); if (tier > 0) setBigWin({ tier: tier as 1 | 2 | 3, amount: payout });
  };

  const deal = async () => {
    if (userBalance < stake) { setMsg('Insufficient balance'); return; }
    setBusy(true);
    try {
      const r = await casinoHiLoStart(stake);
      lockedStake.current = stake; onSetBalance(r.balance);
      setRoundId(r.roundId); setCards([r.card]); setTotal(r.total); setOpts(r.options); setSteps(0); setResult(null); setWinAmt(0);
      setMsg('Higher or lower?'); sfx.click();
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };
  const guess = async (g: 'higher' | 'lower') => {
    if (!roundId || busy) return;
    setBusy(true);
    try {
      const r = await casinoHiLoGuess(roundId, g);
      setCards((c) => [...c, r.card].slice(-6)); sfx.click();
      if (!r.won) { setRoundId(null); setResult('lose'); setTotal(1); setMsg('Wrong guess — round over'); sfx.stop(); if (r.balance !== undefined) onSetBalance(r.balance); }
      else if (r.finished) { setRoundId(null); setTotal(r.total ?? 1); if (r.balance !== undefined) onSetBalance(r.balance); celebrate(r.payout ?? 0); setMsg('Maximum multiplier reached!'); }
      else { setTotal(r.total ?? 1); setOpts(r.options ?? { higher: 0, lower: 0 }); setSteps(r.steps ?? steps + 1); setMsg('Correct! Go again or cash out'); sfx.win(false); }
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };
  const cashout = async () => {
    if (!roundId || busy || steps < 1) return;
    setBusy(true);
    try {
      const r = await casinoHiLoCashout(roundId);
      onSetBalance(r.balance); setRoundId(null); celebrate(r.payout); setMsg(`Cashed out at ${r.multiplier.toFixed(2)}x`);
    } catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  };

  const current = cards[cards.length - 1];
  const optBtn = (g: 'higher' | 'lower', label: string, arrow: string, tone: string) => (
    <button disabled={!playing || busy || opts[g] === 0} onClick={() => guess(g)} className={`flex-1 py-4 rounded-xl font-black text-lg text-white shadow-lg disabled:opacity-35 active:scale-[.97] transition ${tone}`}>
      <div>{arrow} {label}</div><div className="text-xs font-bold opacity-90 tabular-nums">{opts[g] ? `→ ${opts[g].toFixed(2)}x` : 'not possible'}</div>
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} disabled={playing} className="text-sm text-gray-300 hover:text-white disabled:opacity-40">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide">HI-LO</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>

      <div className="rounded-2xl border-2 border-emerald-500/40 p-4 cabinet-glow" style={{ background: 'radial-gradient(circle at 50% 0%, #065f46, #022c22 70%)' }}>
        <div className="flex justify-center items-end gap-2 min-h-[130px]">
          {cards.slice(0, -1).map((c, i) => <div key={i} className="opacity-60 scale-75 origin-bottom"><PlayingCard card={face(c)} size="md" /></div>)}
          {current ? <PlayingCard key={cards.length} card={face(current)} size="lg" flipIn={80} /> : <div className="w-20 h-[114px] rounded-lg border-2 border-dashed border-white/25 flex items-center justify-center text-white/30 text-3xl">?</div>}
        </div>
        <div className="text-center mt-3">
          <div className="text-3xl font-black tabular-nums text-brand-yellow" style={{ textShadow: '0 0 18px rgba(250,204,21,.5)' }}>{total.toFixed(2)}x</div>
          <div className="text-sm font-bold text-gray-100 min-h-[22px]">{result === 'win' ? <span className="win-pop inline-block text-emerald-300">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>
        </div>
      </div>

      {playing ? (
        <>
          <div className="flex gap-3 mt-4">{optBtn('higher', 'HIGHER', '▲', 'bg-gradient-to-b from-green-500 to-green-700')}{optBtn('lower', 'LOWER', '▼', 'bg-gradient-to-b from-rose-500 to-rose-700')}</div>
          <button onClick={cashout} disabled={busy || steps < 1} className="mt-3 w-full py-3 rounded-xl font-black text-lg bg-gradient-to-b from-amber-300 to-orange-600 text-black disabled:opacity-40 shadow-lg">
            CASH OUT · {(lockedStake.current * total).toFixed(2)} L
          </button>
        </>
      ) : (
        <>
          <div className="mt-4"><StakeInput value={stake} onChange={setStake} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={busy} /></div>
          <button onClick={deal} disabled={busy || userBalance < stake} className="mt-3 w-full py-4 rounded-xl font-black text-xl bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">DEAL · {stake} L</button>
        </>
      )}
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · Ace is low, King is high · equal cards lose · 97% fair odds on every guess</div>
    </div>
  );
};
export default HiLo;
