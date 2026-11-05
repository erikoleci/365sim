import React, { useEffect, useRef, useState } from 'react';
import * as api from '../../services/api';
import SymbolIcon from './SymbolIcon';
import CountUp from './CountUp';
import CoinBurst from './CoinBurst';
import { sfx, setSound, soundOn } from './slotSound';
import './casino.css';

const SYM: Record<string, string> = { GUMMY: '🍬', LOLLI: '🍭', DONUT: '🍩', CUPCAKE: '🧁', ICECREAM: '🍦', CAKE: '🎂', CHOCO: '🍫', SCATTER: '🎁' };
const fmt = (n: number, cur: 'ALL' | 'EUR') => `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === 'EUR' ? '€' : 'L'}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEMO_START = { ALL: 100000, EUR: 1000 };

interface Props { balance?: number; balanceEur?: number; accountCurrency?: 'ALL' | 'EUR' | 'BOTH'; onBalances?: (lek: number, eur: number) => void; onClose: () => void }

// Sugar Cascade: 6x5 grid, 8+ equal symbols pay anywhere, winners pop, the rest fall, new ones drop in.
// The server draws the whole round (every step); this component only plays it back.
const TumbleSlot: React.FC<Props> = ({ balance = 0, balanceEur = 0, accountCurrency = 'BOTH', onBalances, onClose }) => {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.casinoTumbleInfo>> | null>(null);
  const startCur: 'ALL' | 'EUR' = accountCurrency === 'EUR' ? 'EUR' : 'ALL';
  const [currency, setCurrency] = useState<'ALL' | 'EUR'>(startCur);
  const [stake, setStake] = useState(0);
  const [grid, setGrid] = useState<string[][]>([]);
  const [gen, setGen] = useState(0);                // bumps on every refill so the symbols drop in
  const [pop, setPop] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(0);        // win so far in this round
  const [mult, setMult] = useState(1);
  const [freeLeft, setFreeLeft] = useState<{ n: number; of: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [final, setFinal] = useState(0);
  const [burst, setBurst] = useState(0);
  const [snd, setSnd] = useState(soundOn());
  const [demoBal, setDemoBal] = useState({ ...DEMO_START });
  const [showPay, setShowPay] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    api.casinoTumbleInfo().then((i) => {
      setInfo(i); setStake(i.stakes[startCur][3]);
      setGrid(Array.from({ length: i.cols }, (_, c) => Array.from({ length: i.rows }, (_, r) => ['GUMMY', 'LOLLI', 'DONUT', 'CUPCAKE', 'ICECREAM', 'CAKE', 'CHOCO'][(c * 2 + r * 3) % 7])));
    }).catch((e) => setMsg(e?.message || 'Gabim'));
  }, [startCur]);

  if (!info) return <div className="text-brand-textMuted text-sm p-4">{msg || 'Duke ngarkuar...'}</div>;
  const demo = info.demo;
  const bal = demo ? demoBal[currency] : currency === 'EUR' ? balanceEur : balance;

  const play = async () => {
    if (busy) return;
    if (bal < stake) { setMsg('Gjendja nuk mjafton.'); return; }
    setBusy(true); setMsg(''); setFinal(0); setRunning(0); setMult(1); setFreeLeft(null); setPop(new Set());
    try {
      const res = await api.casinoTumbleSpin(stake, currency);
      if (!alive.current) return;
      let shown = 0; const freeTotal = res.spins.length - 1;
      for (let i = 0; i < res.spins.length; i += 1) {
        const sp = res.spins[i];
        if (sp.free) setFreeLeft({ n: i, of: freeTotal });
        if (i === 1) { setMsg(`${freeTotal} RROTULLIME FALAS!`); sfx.win(true); await sleep(1100); setMsg(''); }
        setMult(1); sfx.spin();
        setGrid(sp.first); setGen((g) => g + 1); await sleep(650);
        if (sp.scatterWin > 0) { shown += sp.scatterWin; setRunning(shown); sfx.win(true); await sleep(500); }
        for (const st of sp.steps) {
          if (!alive.current) return;
          const cells = new Set(st.wins.flatMap((w) => w.cells.map(([c, r]) => `${c}-${r}`)));
          setPop(cells); sfx.win(st.win >= stake * 2); await sleep(650);
          shown += st.win; setRunning(shown); if (sp.free) setMult(st.multiplier + 1);
          setPop(new Set()); setGrid(st.grid); setGen((g) => g + 1); sfx.stop(); await sleep(520);
        }
        if (sp.free) await sleep(250);
      }
      if (demo) setDemoBal((b) => ({ ...b, [currency]: Math.round((b[currency] - stake + res.payout) * 100) / 100 }));
      else if (res.balance !== undefined) onBalances?.(res.balance, res.balanceEur ?? balanceEur);
      setFinal(res.payout); setFreeLeft(null);
      if (res.payout >= stake * 5) setBurst((n) => n + 1);
    } catch (e: any) { setMsg(e?.message || 'Gabim'); } finally { setPop(new Set()); if (alive.current) setBusy(false); }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden text-white" style={{ background: 'radial-gradient(ellipse at 50% 0%, #be185d 0%, #4a044e 45%, #12041a 100%)' }}>
      {burst > 0 && <CoinBurst key={burst} />}
      <div className="flex items-center justify-between px-4 py-3 bg-black/40">
        <button onClick={onClose} disabled={busy} className="text-sm text-gray-200 hover:text-white disabled:opacity-40">‹ Lobby</button>
        <div className="text-center"><div className="font-extrabold text-lg text-pink-200">Sugar Cascade</div><div className="text-[10px] text-brand-yellow">RTP ~94% · 8+ simbole paguajnë kudo · deri {info.maxWin}x</div></div>
        <div className="flex gap-1.5">
          <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
          <button onClick={() => setShowPay(true)} className="text-xs px-2 py-1 rounded bg-white/10">Pagesat</button>
        </div>
      </div>
      <div className="p-3 sm:p-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between text-sm mb-2">
          <div className="flex rounded overflow-hidden border border-white/20">
            {(['ALL', 'EUR'] as const).filter((c) => accountCurrency === 'BOTH' || accountCurrency === c).map((c) => (
              <button key={c} disabled={busy} onClick={() => { setCurrency(c); setStake(info.stakes[c][3]); }} className={`px-3 py-1 ${currency === c ? 'bg-brand-yellow text-black font-bold' : 'bg-black/30 text-gray-300'}`}>{c === 'ALL' ? 'L' : '€'}</button>
            ))}
          </div>
          <div>Gjendja: <b className="tabular-nums">{fmt(bal, currency)}</b></div>
        </div>
        {freeLeft && <div className="text-center text-xs font-bold text-cyan-200 mb-1">RROTULLIM FALAS {freeLeft.n}/{freeLeft.of}</div>}
        <div className="relative rounded-2xl p-2 sm:p-3 border-4 border-pink-300/70 bg-black/45 shadow-[0_0_30px_rgba(244,114,182,0.35)]">
          {mult > 1 && <div className="absolute -top-3 right-3 z-10 px-3 py-0.5 rounded-full bg-gradient-to-b from-yellow-300 to-amber-500 text-black font-black text-sm shadow">x{mult}</div>}
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${info.cols}, minmax(0, 1fr))` }}>
            {grid.map((col, c) => (
              <div key={c} className="grid gap-1" style={{ gridTemplateRows: `repeat(${info.rows}, minmax(0, 1fr))` }}>
                {col.map((s, r) => {
                  const key = `${c}-${r}`; const win = pop.has(key);
                  return (
                    <div key={`${gen}-${key}`} className={`aspect-square rounded-lg flex items-center justify-center p-1 bg-white/10 ${win ? 'tumble-win bg-yellow-200/30 ring-2 ring-yellow-300' : 'tumble-drop'}`} style={{ animationDelay: win ? undefined : `${(info.rows - r) * 25 + c * 15}ms` }}>
                      <SymbolIcon symbol={SYM[s] || s} className="w-full h-full" />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="h-14 flex flex-col items-center justify-center text-center">
          {msg && <div className="text-sm font-extrabold text-cyan-200">{msg}</div>}
          {!msg && (busy ? running > 0 && <div className="text-lg font-extrabold text-brand-yellow">Fitim: {fmt(running, currency)}</div> : final > 0 ? <div className="text-xl font-extrabold text-brand-yellow win-pop">Fitove <CountUp value={final} format={(n) => fmt(n, currency)} />!</div> : null)}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 mb-3">
          {info.stakes[currency].map((s) => (<button key={s} disabled={busy} onClick={() => setStake(s)} className={`px-2.5 py-1 rounded text-xs tabular-nums ${stake === s ? 'bg-brand-yellow text-black font-bold' : 'bg-black/40 text-gray-200'}`}>{s}</button>))}
        </div>
        <button onClick={play} disabled={busy || bal < stake} className="w-full py-3 rounded-xl font-extrabold text-lg bg-gradient-to-b from-pink-500 to-fuchsia-700 text-white disabled:opacity-50 shadow-lg">{busy ? '...' : `ROTULLO · ${stake} ${currency === 'EUR' ? '€' : 'L'}`}</button>
        <div className="text-[10px] text-center text-gray-300 mt-2">4+ {SYM.SCATTER} (dhurata) japin {info.freeSpins} rrotullime falas. Në rrotullimet falas, çdo shembje fituese e rrit shumëzuesin me +1 deri në fund të raundit.</div>
      </div>
      {showPay && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={() => setShowPay(false)}>
          <div className="bg-brand-panel rounded-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-4 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2"><b>Sugar Cascade · Pagesat</b><button onClick={() => setShowPay(false)}>✕</button></div>
            <div className="text-[11px] text-gray-400 mb-3">Shumëfisha të bastit total për 8–9 / 10–11 / 12+ simbole të njëjta kudo në tabelë.</div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-gray-400 text-xs"><th className="text-left">Simboli</th><th>8-9</th><th>10-11</th><th>12+</th></tr></thead><tbody>
              {Object.entries(info.paytable).reverse().map(([k, v]) => (
                <tr key={k} className="border-t border-white/10"><td className="py-1"><span className="inline-block w-8 h-8"><SymbolIcon symbol={SYM[k]} className="w-full h-full" /></span></td>{v.map((x, i) => <td key={i} className="text-center tabular-nums">{x}x</td>)}</tr>
              ))}
              <tr className="border-t border-white/10"><td className="py-1"><span className="inline-block w-8 h-8"><SymbolIcon symbol={SYM.SCATTER} className="w-full h-full" /></span></td>{[4, 5, 6].map((n) => <td key={n} className="text-center text-xs">{n}{n === 6 ? '+' : ''}: {info.scatterPay[n]}x</td>)}</tr>
            </tbody></table></div>
            <div className="text-[11px] text-gray-400 mt-3">Fitimi maksimal për një raund: {info.maxWin}x bastin. Simbolet: Twemoji (CC-BY 4.0).</div>
          </div>
        </div>
      )}
    </div>
  );
};
export default TumbleSlot;
