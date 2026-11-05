import React, { useEffect, useState } from 'react';
import { casinoLive, LiveWin } from '../../services/api';

const NAMES: Record<string, string> = {
  tumble: 'Sugar Cascade', plinko: 'Plinko', mines: 'Mines', dragontiger: 'Dragon Tiger', wheel: 'Wheel of Fortune', keno: 'Keno', scratch: 'Scratch & Win',
  baccarat: 'Baccarat', blackjack: 'Blackjack', roulette: 'Roulette', videopoker: 'Video Poker', dice: 'Dice', crash: 'Crash', hilo: 'Hi-Lo',
  holdwin: 'Hold & Win', penalty: 'Penalty Shootout', tower: 'Gold Tower', horses: 'Horse Race', cups: 'Three Cups',
};
const gameName = (g: string) => NAMES[g] || g.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; };
const money = (n: number, c: string) => `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c === 'EUR' ? '€' : 'L'}`;

// LIVE: real rounds played by real players on this site in the last 24 hours (names masked). Nothing here is invented.
const LiveWins: React.FC = () => {
  const [data, setData] = useState<{ feed: LiveWin[]; playersLastHour: number; roundsLastHour: number; preview?: boolean } | null>(null);
  const [tab, setTab] = useState<'wins' | 'all'>('wins');
  useEffect(() => {
    let on = true;
    const load = () => casinoLive().then((d) => { if (on) setData(d); }).catch(() => {});
    load(); const t = window.setInterval(load, 8000);
    return () => { on = false; window.clearInterval(t); };
  }, []);
  if (!data) return null;
  const list = (tab === 'wins' ? data.feed.filter((f) => f.payout > f.stake) : data.feed).slice(0, 12);
  return (
    <div className="mb-8 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1a1a24] to-[#101018] p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-xl font-bold flex items-center gap-2"><span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" /><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" /></span>Casino Live</h3>
        <div className="text-xs text-gray-400"><b className="text-white">{data.playersLastHour}</b> players · <b className="text-white">{data.roundsLastHour}</b> rounds in the last hour</div>
      </div>
      <div className="flex gap-1.5 mb-3">
        {(['wins', 'all'] as const).map((k) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1 rounded-full text-xs font-bold ${tab === k ? 'bg-brand-yellow text-black' : 'bg-white/10 text-gray-200'}`}>{k === 'wins' ? 'Latest wins' : 'All rounds'}</button>)}
      </div>
      {list.length === 0 ? <div className="text-xs text-gray-500 py-4 text-center">No {tab === 'wins' ? 'wins' : 'rounds'} from players yet today. Be the first!</div> : (
        <ul className="divide-y divide-white/5">
          {list.map((f, i) => (
            <li key={`${f.at}-${i}`} className="flex items-center justify-between py-2 text-sm gap-2">
              <div className="min-w-0"><div className="font-bold truncate">{gameName(f.game)}</div><div className="text-[11px] text-gray-400">{f.player} · {ago(f.at)}</div></div>
              <div className="text-right shrink-0">{f.payout > 0 ? <><div className="font-black text-green-400 tabular-nums">+{money(f.payout, f.currency)}</div><div className="text-[11px] text-brand-yellow tabular-nums">{f.multiplier.toFixed(2)}x</div></> : <div className="text-xs text-gray-500 tabular-nums">−{money(f.stake, f.currency)}</div>}</div>
            </li>
          ))}
        </ul>
      )}
      {data.preview && <div className="text-[10px] text-gray-500 mt-3 text-center">Credit only · the live feed includes simulated players</div>}
    </div>
  );
};
export default LiveWins;
