import React, { useRef, useState } from 'react';
import { casinoScratchPlay } from '../../services/api';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import { sfx, setSound, soundOn } from './slotSound';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const STAKES = [10, 50, 100, 500, 1000];

// Scratch card: buy a card, tap the silver squares to scratch them (or "Zbulo gjithçka"). Three equal prizes win.
const Scratch: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [stake, setStake] = useState(100);
  const [card, setCard] = useState<{ cells: number[]; multiplier: number; payout: number; balance: number } | null>(null);
  const [open, setOpen] = useState<boolean[]>(Array(9).fill(false));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('Bli një letër dhe gërvishtë');
  const [burst, setBurst] = useState(0);
  const [snd, setSnd] = useState(soundOn());
  const paid = useRef(false);

  const finish = (c: NonNullable<typeof card>) => {
    if (paid.current) return; paid.current = true;
    onSetBalance(c.balance);
    if (c.payout > 0) { sfx.win(c.multiplier >= 5); if (c.multiplier >= 5) setBurst((b) => b + 1); setMsg(`FITOVE ${c.multiplier}x!`); } else setMsg('Asnjë treshe. Provo një letër tjetër!');
  };
  const buy = async () => {
    if (busy) return;
    if (userBalance < stake) { setMsg('Gjendje e pamjaftueshme'); return; }
    setBusy(true);
    try {
      const c = await casinoScratchPlay(stake);
      paid.current = false; setCard(c); setOpen(Array(9).fill(false)); setMsg('Gërvishtë katrorët!'); sfx.click();
    } catch (e: any) { setMsg(e?.message || 'Gabim'); } finally { setBusy(false); }
  };
  const reveal = (i: number) => {
    if (!card || open[i]) return;
    const next = open.slice(); next[i] = true; setOpen(next); sfx.click();
    if (next.every(Boolean)) finish(card);
  };
  const revealAll = () => { if (!card) return; setOpen(Array(9).fill(true)); finish(card); };
  const done = card && open.every(Boolean);
  const winCells = card && done && card.multiplier > 0 ? card.cells.map((c) => c === card.multiplier) : [];

  return (
    <div className="relative rounded-2xl overflow-hidden text-white p-4 sm:p-6 min-h-[600px] flex flex-col items-center" style={{ background: 'radial-gradient(ellipse at 50% 0%, #7c2d12 0%, #1c0a05 75%)' }}>
      {burst > 0 && <CoinBurst key={burst} />}
      <div className="w-full flex items-center justify-between mb-3">
        <button onClick={onClose} className="text-sm text-gray-200 hover:text-white font-semibold">‹ Lobby</button>
        <div className="font-extrabold text-xl text-brand-yellow">Gërvisht &amp; Fito</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>
      <div className="rounded-2xl p-3 sm:p-4 w-full max-w-sm border-4 border-yellow-500/80 shadow-[0_0_30px_rgba(250,204,21,0.25)]" style={{ background: 'linear-gradient(145deg, #fde68a, #f59e0b 55%, #b45309)' }}>
        <div className="text-center text-[#5b2503] font-extrabold tracking-widest text-sm mb-2">NDIZ 3 TË NJËJTAT DHE FITO</div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }, (_, i) => {
            const val = card?.cells[i]; const isOpen = open[i]; const w = winCells[i];
            return (
              <button key={i} onClick={() => reveal(i)} disabled={!card} className={`aspect-square rounded-xl flex items-center justify-center text-2xl sm:text-3xl font-black select-none transition ${isOpen ? (w ? 'bg-yellow-200 text-red-700 ring-4 ring-red-500 scale-105' : 'bg-white text-[#3b1a06]') : 'text-transparent'}`}
                style={isOpen ? undefined : { background: 'repeating-linear-gradient(135deg, #cbd5e1 0 6px, #94a3b8 6px 12px)', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.35)' }}>
                {isOpen ? `${val}x` : '?'}
              </button>
            );
          })}
        </div>
      </div>
      <div className="h-14 flex flex-col items-center justify-center text-center mt-3">
        {done && card && card.payout > 0 ? <div className="text-2xl font-extrabold text-brand-yellow win-pop">{msg} · <CountUp value={card.payout} format={(v) => `${v.toFixed(2)} L`} /></div> : <div className="text-lg font-bold text-gray-100">{msg}</div>}
      </div>
      <div className="flex flex-wrap justify-center gap-2 mb-3">
        {STAKES.map((s) => (<button key={s} disabled={busy || (!!card && !done)} onClick={() => setStake(s)} className={`px-3 py-1.5 rounded-lg text-sm tabular-nums border ${stake === s ? 'bg-brand-yellow text-black font-bold border-brand-yellow' : 'bg-black/40 text-gray-200 border-white/15'}`}>{s}</button>))}
      </div>
      <div className="flex gap-2 w-full max-w-sm">
        {card && !done && <button onClick={revealAll} className="px-4 rounded-xl border border-white/25 text-gray-100">Zbulo gjithçka</button>}
        <button onClick={buy} disabled={busy || (!!card && !done) || userBalance < stake} className="flex-1 py-3 rounded-xl font-extrabold text-lg bg-gradient-to-b from-green-500 to-green-700 text-white disabled:opacity-50 shadow-lg">{busy ? '...' : `BLI LETËR · ${stake} L`}</button>
      </div>
      <div className="text-[11px] text-gray-400 mt-2">Gjendja: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · RTP 94% · deri 50x</div>
    </div>
  );
};
export default Scratch;
