import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../services/api';

// The ten paylines (row per reel), same as the server's engine: used only to light up the winning cells.
const PAYLINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
];
const fmt = (n: number, cur: 'ALL' | 'EUR') => `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === 'EUR' ? '€' : 'L'}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEMO_START = { ALL: 100000, EUR: 1000 };

interface Props {
  /** Real wallet of the player (ignored in demo mode). */
  balance?: number;
  balanceEur?: number;
  onBalances?: (lek: number, eur: number) => void;
  onClose?: () => void;
}

// Lobby of the five slots + the game itself. The result of every round comes from the server (it is drawn and
// paid there); this component only animates it. The super admin plays on demo money, players on their wallet.
const SlotGames: React.FC<Props> = ({ balance = 0, balanceEur = 0, onBalances }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.casinoSlotGames>> | null>(null);
  const [game, setGame] = useState<api.SlotGameInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { api.casinoSlotGames().then(setData).catch((e) => setError(e?.message || 'Gabim')); }, []);
  if (error) return <div className="text-red-400 text-sm p-4">{error}</div>;
  if (!data) return <div className="text-brand-textMuted text-sm p-4">Duke ngarkuar...</div>;

  if (game) return <SlotGame game={game} stakes={data.stakes} demo={data.demo} balance={balance} balanceEur={balanceEur} onBalances={onBalances} onBack={() => setGame(null)} />;

  return (
    <div>
      {data.demo && <div className="mb-3 text-xs bg-yellow-500/10 border border-yellow-500/40 text-yellow-300 rounded px-3 py-2">Modaliteti DEMO: luan me para virtuale. Asgjë nuk zbritet dhe nuk shtohet te asnjë llogari.</div>}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {data.games.map((g) => (
          <button key={g.id} onClick={() => setGame(g)} className="text-left rounded-xl overflow-hidden border border-white/10 hover:border-brand-yellow/60 hover:scale-[1.02] transition-all shadow-lg"
            style={{ background: `linear-gradient(145deg, ${g.color[0]}, ${g.color[1]})` }}>
            <div className="flex justify-center gap-1 text-3xl pt-5 pb-3">{['WILD', Object.keys(g.paytable).find((k) => k !== 'WILD' && g.paytable[k][5] === Math.max(...Object.keys(g.paytable).filter((x) => x !== 'WILD').map((x) => g.paytable[x][5])))!, 'SCATTER'].map((k, i) => <span key={i}>{g.symbols[k]}</span>)}</div>
            <div className="px-3 pb-3 bg-black/40 pt-2">
              <div className="font-bold text-white">{g.name}</div>
              <div className="text-[11px] text-gray-300 min-h-[30px]">{g.tagline}</div>
              <div className="flex justify-between text-[10px] mt-1 text-brand-yellow"><span>RTP {g.rtp.toFixed(2)}%</span><span>{g.volatility}</span></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const SlotGame: React.FC<{
  game: api.SlotGameInfo; stakes: { ALL: number[]; EUR: number[] }; demo: boolean; balance: number; balanceEur: number;
  onBalances?: (lek: number, eur: number) => void; onBack: () => void;
}> = ({ game, stakes, demo, balance, balanceEur, onBalances, onBack }) => {
  const [currency, setCurrency] = useState<'ALL' | 'EUR'>('ALL');
  const [stake, setStake] = useState(stakes.ALL[3]);
  const [demoBal, setDemoBal] = useState({ ...DEMO_START });
  const [grid, setGrid] = useState<string[][]>(() => idleGrid(game));
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false, false, false]);
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lastWin, setLastWin] = useState(0);
  const [freeInfo, setFreeInfo] = useState('');
  const [showPay, setShowPay] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const wallet = demo ? demoBal : { ALL: balance, EUR: balanceEur };
  const bal = wallet[currency];
  const pool = Object.keys(game.symbols);

  const switchCurrency = (c: 'ALL' | 'EUR') => { if (busy) return; setCurrency(c); setStake(stakes[c][3]); };

  const animateStop = useCallback(async (finalGrid: string[][], quick: boolean) => {
    setLit(new Set());
    setSpinning([true, true, true, true, true]);
    const timer = setInterval(() => {
      setGrid((g) => g.map((col, r) => (spinningRef.current[r] ? [0, 1, 2].map(() => game.symbols[pool[Math.floor(Math.random() * pool.length)]]) : col)));
    }, 70);
    for (let r = 0; r < 5; r += 1) {
      await sleep(quick ? 140 : 320);
      spinningRef.current[r] = false;
      setGrid((g) => g.map((col, i) => (i === r ? finalGrid[r].map((s) => game.symbols[s]) : col)));
      setSpinning((sp) => sp.map((v, i) => (i === r ? false : v)));
    }
    clearInterval(timer);
  }, [game, pool]);
  const spinningRef = useRef<boolean[]>([false, false, false, false, false]);

  const lightUp = (sp: api.SlotSpin) => {
    const cells = new Set<string>();
    sp.wins.forEach((w) => { for (let r = 0; r < w.count; r += 1) cells.add(`${r}-${PAYLINES[w.line][r]}`); });
    if (sp.scatters >= 3) sp.grid.forEach((col, r) => col.forEach((s, row) => { if (s === 'SCATTER') cells.add(`${r}-${row}`); }));
    setLit(cells);
  };

  const spin = async () => {
    if (busy) return;
    if (bal < stake) { setMsg('Gjendja nuk mjafton.'); return; }
    setBusy(true); setMsg(''); setLastWin(0); setFreeInfo('');
    try {
      spinningRef.current = [true, true, true, true, true];
      const res = await api.casinoSlotSpin(game.id, stake, currency);
      if (!alive.current) return;
      let shown = 0;
      for (let i = 0; i < res.spins.length; i += 1) {
        const sp = res.spins[i];
        if (i > 0) setFreeInfo(`RROTULLIM FALAS ${i}/${res.spins.length - 1} · x${game.freeSpinMultiplier}`);
        spinningRef.current = [true, true, true, true, true];
        await animateStop(sp.grid, i > 0);
        if (!alive.current) return;
        shown += sp.win;
        setLastWin(shown);
        lightUp(sp);
        if (sp.win > 0) await sleep(i === 0 ? 900 : 650);
        else if (i > 0) await sleep(350);
      }
      if (demo) setDemoBal((b) => ({ ...b, [currency]: Math.round((b[currency] - stake + res.payout) * 100) / 100 }));
      else if (res.balance !== undefined) onBalances?.(res.balance, res.balanceEur ?? balanceEur);
      setLastWin(res.payout);
      setMsg(res.payout > 0 ? `Fitove ${fmt(res.payout, currency)}!` : '');
      if (res.freeSpins > 0) setFreeInfo(`${res.freeSpins} rrotullime falas u luajtën`);
    } catch (e: any) {
      setMsg(e?.message || 'Gabim');
    } finally {
      spinningRef.current = [false, false, false, false, false];
      setSpinning([false, false, false, false, false]);
      if (alive.current) setBusy(false);
    }
  };

  const top = Object.keys(game.paytable).filter((k) => k !== 'WILD');
  return (
    <div className="rounded-xl overflow-hidden border border-white/10" style={{ background: `linear-gradient(160deg, ${game.color[0]}, ${game.color[1]})` }}>
      <div className="flex items-center justify-between px-4 py-3 bg-black/40">
        <button onClick={onBack} disabled={busy} className="text-sm text-gray-300 hover:text-white disabled:opacity-40">← Slots</button>
        <div className="text-center"><div className="font-bold text-white">{game.name}</div><div className="text-[10px] text-brand-yellow">RTP {game.rtp.toFixed(2)}% · {game.volatility} · {game.lines} linja</div></div>
        <button onClick={() => setShowPay(true)} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white">Pagesat</button>
      </div>

      <div className="p-4">
        {demo && <div className="mb-2 text-[11px] text-yellow-300 text-center">DEMO · para virtuale</div>}
        <div className="flex items-center justify-between text-sm mb-3">
          <div className="flex rounded overflow-hidden border border-white/20">
            {(['ALL', 'EUR'] as const).map((c) => (
              <button key={c} onClick={() => switchCurrency(c)} className={`px-3 py-1 ${currency === c ? 'bg-brand-yellow text-black font-bold' : 'bg-black/30 text-gray-300'}`}>{c === 'ALL' ? 'L' : '€'}</button>
            ))}
          </div>
          <div className="text-white">Gjendja: <b className="tabular-nums">{fmt(bal, currency)}</b></div>
        </div>

        <div className="bg-black/50 rounded-xl p-2 sm:p-3 border-4 border-yellow-700/60">
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {grid.map((col, r) => (
              <div key={r} className="flex flex-col gap-1.5 sm:gap-2">
                {col.map((sym, row) => (
                  <div key={row} className={`aspect-square flex items-center justify-center text-3xl sm:text-5xl rounded-lg bg-white/10 transition-all ${spinning[r] ? 'blur-[1.5px] scale-95' : ''} ${lit.has(`${r}-${row}`) ? 'ring-2 ring-brand-yellow bg-yellow-400/25 scale-105' : ''}`}>{sym}</div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="h-12 flex flex-col items-center justify-center text-center">
          {freeInfo && <div className="text-xs font-bold text-cyan-300">{freeInfo}</div>}
          {(lastWin > 0 || msg) && <div className={`text-lg font-extrabold ${lastWin > 0 ? 'text-brand-yellow' : 'text-red-300'}`}>{busy && lastWin > 0 ? `Fitim: ${fmt(lastWin, currency)}` : msg}</div>}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1.5 mb-3">
          {stakes[currency].map((s) => (
            <button key={s} disabled={busy} onClick={() => setStake(s)} className={`px-2.5 py-1 rounded text-xs tabular-nums ${stake === s ? 'bg-brand-yellow text-black font-bold' : 'bg-black/40 text-gray-200 hover:bg-black/60'}`}>{s}</button>
          ))}
        </div>
        <button onClick={spin} disabled={busy || bal < stake} className="w-full py-3 rounded-xl font-extrabold text-lg bg-green-600 hover:bg-green-500 text-white disabled:opacity-50">
          {busy ? '...' : `ROTULLO · ${stake} ${currency === 'EUR' ? '€' : 'L'}`}
        </button>
        <div className="text-[10px] text-center text-gray-400 mt-2">3 ose më shumë {game.symbols.SCATTER} ({game.scatterName}) japin rrotullime falas. {game.symbols.WILD} ({game.wildName}) zëvendëson simbolet.</div>
      </div>

      {showPay && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={() => setShowPay(false)}>
          <div className="bg-brand-panel rounded-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-4 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2"><b>{game.name} · Tabela e pagesave</b><button onClick={() => setShowPay(false)}>✕</button></div>
            <div className="text-[11px] text-gray-400 mb-3">Pagesat janë shumëfisha të bastit për një linjë (stake ÷ {game.lines}). RTP teorik: {game.rtp.toFixed(2)}%.</div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-gray-400 text-xs"><th className="text-left">Simboli</th><th>x3</th><th>x4</th><th>x5</th></tr></thead>
              <tbody>
                {[...top.reverse(), 'WILD'].map((k) => (
                  <tr key={k} className="border-t border-white/10"><td className="py-1 text-2xl">{game.symbols[k]}</td>{[3, 4, 5].map((n) => <td key={n} className="text-center tabular-nums">{game.paytable[k][n]}</td>)}</tr>
                ))}
                <tr className="border-t border-white/10"><td className="py-1 text-2xl">{game.symbols.SCATTER}</td>{[3, 4, 5].map((n) => <td key={n} className="text-center tabular-nums text-xs">{game.scatterPay[n]}× stake<br />{game.freeSpins[n]} falas</td>)}</tr>
              </tbody>
            </table></div>
            <div className="text-[11px] text-gray-400 mt-3">Rrotullimet falas paguajnë x{game.freeSpinMultiplier}.{game.wildExpand ? ' Wild zgjerohet mbi gjithë rrotën.' : ''} Fitimi maksimal për një raund: 2000× stake.</div>
          </div>
        </div>
      )}
    </div>
  );
};

function idleGrid(game: api.SlotGameInfo): string[][] {
  const base = Object.keys(game.symbols).filter((k) => k !== 'WILD' && k !== 'SCATTER');
  return [0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((row) => game.symbols[base[(r * 3 + row) % base.length]]));
}

export default SlotGames;
