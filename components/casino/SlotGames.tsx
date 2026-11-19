import BigWin, { winTier } from './BigWin';
import './lobby/lobby.css';
import SlotLever from './SlotLever';
import StakeInput from './StakeInput';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../services/api';
import SlotReel from './SlotReel';
import { slotTheme, THEME_ORN, THEME_METAL } from './slotThemes';
import { loadSlotArt, clearSlotArt, getBg } from './slotArt';
import CountUp from './CountUp';
import CoinBurst from './CoinBurst';
import SymbolIcon from './SymbolIcon';
import GameLoader from './GameLoader';
import GameShell from './GameShell';
import { sfx, setSound, soundOn } from './slotSound';

// The 3D reels (Three.js) are a separate chunk, fetched only when a slot is opened; without WebGL the CSS reels stay.
const Reels3D = React.lazy(() => import('./slot3d/Reels3D'));
const webglOk = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };

// The ten paylines (row per reel), same as the server's engine: used only to light up the winning cells.
const PAYLINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
];
const fmt = (n: number, cur: 'ALL' | 'EUR') => `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === 'EUR' ? '€' : 'L'}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEMO_START = { ALL: 100000, EUR: 1000 };

// Cover art from public/slots/<game id>.jpg. Games without a picture fall back to their symbols.
const CoverImg: React.FC<{ id: string; name: string; children: React.ReactNode }> = ({ id, name, children }) => {
  const [missing, setMissing] = useState(false);
  if (missing) return <>{children}</>;
  return <img src={`/slots/${id}.jpg`} alt={name} loading="lazy" draggable={false} className="w-full aspect-[250/257] object-cover block" onError={() => setMissing(true)} />;
};

interface Props {
  /** Real wallet of the player (ignored in demo mode). */
  balance?: number;
  balanceEur?: number;
  accountCurrency?: 'ALL' | 'EUR' | 'BOTH';
  onBalances?: (lek: number, eur: number) => void;
  onClose?: () => void;
}

// Lobby of the five slots + the game itself. The result of every round comes from the server (it is drawn and
// paid there); this component only animates it. The super admin plays on demo money, players on their wallet.
const SlotGames: React.FC<Props> = ({ balance = 0, balanceEur = 0, accountCurrency = 'BOTH', onBalances }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.casinoSlotGames>> | null>(null);
  const [game, setGame] = useState<api.VideoSlotInfo | null>(null);
  const [error, setError] = useState('');
  const [cat, setCat] = useState('All');
  const [query, setQuery] = useState('');
  const [loadingGame, setLoadingGame] = useState<api.VideoSlotInfo | null>(null);
  const [favs, setFavs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('slotFavs') || '[]'); } catch { return []; } });
  const toggleFav = (id: string) => setFavs((f) => { const n = f.includes(id) ? f.filter((x) => x !== id) : [...f, id]; try { localStorage.setItem('slotFavs', JSON.stringify(n)); } catch { /* ignore */ } return n; });

  useEffect(() => { api.casinoSlotGames().then(setData).catch((e) => setError(e?.message || 'Error')); }, []);
  if (error) return <div className="text-red-400 text-sm p-4">{error}</div>;
  if (!data) return <div className="text-brand-textMuted text-sm p-4">Loading...</div>;

  if (game) return <GameShell title={game.name} onBack={() => setGame(null)}><SlotGame game={game} stakes={data.stakes} demo={data.demo} balance={balance} balanceEur={balanceEur} accountCurrency={accountCurrency} onBalances={onBalances} onBack={() => setGame(null)} /></GameShell>;

  return (
    <div>
      {loadingGame && <GameLoader name={loadingGame.name} img={`/slots/${loadingGame.id}.jpg`} onDone={() => { setGame(loadingGame); setLoadingGame(null); }} />}
      <h3 className="lb-sec"><span className="lb-serif lb-foil text-2xl font-black">Slot machines</span><span className="text-xs text-slate-400">{data.games.length} games</span></h3>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games…" className="lb-search mb-3" aria-label="Search slots" />
      <div className="flex gap-2 overflow-x-auto pb-3 mb-1">
        {['All', '♥ Favourites', ...Array.from(new Set(data.games.map((g) => g.category || 'Classic')))].map((c) => (
          <button key={c} onClick={() => setCat(c)} role="tab" aria-selected={cat === c} className="lb-chip lb-glass">{c}</button>
        ))}
      </div>
      {data.simulatedPlayers && <div className="text-[10px] text-gray-500 mb-2">Credit only · player counts include simulated players</div>}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        {data.games.filter((g) => (cat === 'All' || (cat === '♥ Favourites' ? favs.includes(g.id) : (g.category || 'Classic') === cat)) && (!query.trim() || g.name.toLowerCase().includes(query.trim().toLowerCase()))).map((g) => (
          <button key={g.id} onClick={() => setLoadingGame(g)} className="lb-card relative"
            style={{ background: `linear-gradient(145deg, ${g.color[0]}, ${g.color[1]})`, ['--acc' as string]: g.color[0] } as React.CSSProperties}>
            <CoverImg id={g.id} name={g.name}>
            <div className="flex justify-center gap-1 text-3xl pt-5 pb-3">{['WILD', Object.keys(g.paytable).find((k) => k !== 'WILD' && g.paytable[k][5] === Math.max(...Object.keys(g.paytable).filter((x) => x !== 'WILD').map((x) => g.paytable[x][5])))!, 'SCATTER'].map((k, i) => <span key={i} className="w-9 h-9 inline-block"><SymbolIcon symbol={g.symbols[k]} className="w-full h-full" /></span>)}</div>
            </CoverImg>
            {data.playing?.[g.id] ? <span className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/65 text-[10px] font-bold text-green-300"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />{data.playing[g.id]} playing</span> : null}
            <span role="button" aria-label="Favourites" onClick={(e) => { e.stopPropagation(); toggleFav(g.id); }} className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/55 flex items-center justify-center text-lg">{favs.includes(g.id) ? <span className="text-red-500">♥</span> : <span className="text-white/80">♡</span>}</span>
            <div className="lb-info" style={{ background: 'linear-gradient(180deg, rgba(8,12,18,.92), #0a1016)' }}>
              <b>{g.name}</b>
              <span>{g.tagline}</span>
              <div className="text-[10px] mt-1 font-bold" style={{ color: '#f3cf6a' }}>{g.volatility}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const SlotGame: React.FC<{
  game: api.VideoSlotInfo; stakes: { ALL: number[]; EUR: number[] }; demo: boolean; balance: number; balanceEur: number; accountCurrency?: 'ALL' | 'EUR' | 'BOTH';
  onBalances?: (lek: number, eur: number) => void; onBack: () => void;
}> = ({ game, stakes, demo, balance, balanceEur, accountCurrency = 'BOTH', onBalances, onBack }) => {
  const startCur: 'ALL' | 'EUR' = accountCurrency === 'EUR' ? 'EUR' : 'ALL';
  const [currency, setCurrency] = useState<'ALL' | 'EUR'>(startCur);
  const [stake, setStake] = useState(stakes[startCur][3]);
  const [demoBal, setDemoBal] = useState({ ...DEMO_START });
  const [grid, setGrid] = useState<string[][]>(() => idleGrid(game));
  const nReels = game.reels ?? 5;
  const lineSet = game.paylines ?? PAYLINES;
  const none = () => Array.from({ length: nReels }, () => false);
  const [spinning, setSpinning] = useState<boolean[]>(none);
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lastWin, setLastWin] = useState(0);
  const [freeInfo, setFreeInfo] = useState('');
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [burst, setBurst] = useState(0); // bumps for every win worth celebrating (key of the coin shower)
  const [showPay, setShowPay] = useState(false);
  const [turbo, setTurbo] = useState(false);
  const [artVer, setArtVer] = useState(0); // bumps when this game's real artwork has been found (reels redraw with it)
  useEffect(() => { let on = true; void loadSlotArt(game).then((n) => { if (on && n > 0) setArtVer(1); }); return () => { on = false; clearSlotArt(); }; }, [game]);
  const [auto, setAuto] = useState(0);
  const [betOpen, setBetOpen] = useState(false);
  const [snd, setSnd] = useState(soundOn());
  const [use3d, setUse3d] = useState(webglOk);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const wallet = demo ? demoBal : { ALL: balance, EUR: balanceEur };
  const bal = wallet[currency];

  const switchCurrency = (c: 'ALL' | 'EUR') => { if (busy) return; setCurrency(c); setStake(stakes[c][3]); };

  const animateStop = useCallback(async (finalGrid: string[][], quick: boolean) => {
    setLit(new Set());
    setSpinning(Array.from({ length: nReels }, () => true));
    sfx.spin();
    for (let r = 0; r < nReels; r += 1) {
      await sleep(quick ? 150 : nReels > 5 ? 300 : 380);
      sfx.stop();
      spinningRef.current[r] = false;
      setGrid((g) => g.map((col, i) => (i === r ? finalGrid[r].map((s) => game.symbols[s]) : col)));
      setSpinning((sp) => sp.map((v, i) => (i === r ? false : v)));
    }
  }, [game, nReels]);
  const spinningRef = useRef<boolean[]>(none());

  const lightUp = (sp: api.SlotSpin) => {
    const cells = new Set<string>();
    sp.wins.forEach((w) => { for (let r = 0; r < w.count; r += 1) cells.add(`${r}-${lineSet[w.line][r]}`); });
    if (sp.scatters >= 3) sp.grid.forEach((col, r) => col.forEach((s, row) => { if (s === 'SCATTER') cells.add(`${r}-${row}`); }));
    setLit(cells);
  };

  const spin = async () => {
    if (busy) return;
    if (bal < stake) { setMsg('Insufficient balance.'); return; }
    setBusy(true); setMsg(''); setLastWin(0); setFreeInfo('');
    try { navigator.vibrate?.(12); } catch { /* not supported */ }
    try {
      spinningRef.current = Array.from({ length: nReels }, () => true);
      const res = await api.casinoSlotSpin(game.id, stake, currency);
      if (!alive.current) return;
      let shown = 0;
      for (let i = 0; i < res.spins.length; i += 1) {
        const sp = res.spins[i];
        if (i > 0) setFreeInfo(`RROTULLIM FALAS ${i}/${res.spins.length - 1} · x${game.freeSpinMultiplier}`);
        spinningRef.current = Array.from({ length: nReels }, () => true);
        await animateStop(sp.grid, i > 0 || turbo);
        if (!alive.current) return;
        shown += sp.win;
        setLastWin(shown);
        lightUp(sp);
        if (sp.win > 0) sfx.win(sp.win >= stake * 3);
        if (sp.win > 0) await sleep(turbo ? 350 : i === 0 ? 900 : 650);
        else if (i > 0) await sleep(350);
      }
      if (demo) setDemoBal((b) => ({ ...b, [currency]: Math.round((b[currency] - stake + res.payout) * 100) / 100 }));
      else if (res.balance !== undefined) onBalances?.(res.balance, res.balanceEur ?? balanceEur);
      setLastWin(res.payout);
      if (res.payout >= stake * 3) { setBurst((n) => n + 1); try { navigator.vibrate?.(res.payout >= stake * 10 ? [40, 30, 80] : 30); } catch { /* not supported */ } }
      { const tier = winTier(res.payout, stake); if (tier > 0) setBigWin({ tier: tier as 1 | 2 | 3, amount: res.payout }); }
      setMsg(res.payout > 0 ? `You won ${fmt(res.payout, currency)}!` : '');
      if (res.freeSpins > 0) setFreeInfo(`${res.freeSpins} free spins played`);
    } catch (e: any) {
      setMsg(e?.message || 'Error');
    } finally {
      spinningRef.current = none();
      setSpinning(none());
      if (alive.current) setBusy(false);
    }
  };

  const stepBet = (dir: number) => {
    const list = stakes[currency]; let i = list.findIndex((v) => v >= stake); if (i < 0) i = list.length - 1;
    const j = Math.min(list.length - 1, Math.max(0, (list[i] === stake ? i : dir > 0 ? i - 1 : i) + dir)); setStake(list[j]);
  };
  // Autoplay: next spin after the previous one is fully shown; stops on a big win, a low balance or an error.
  useEffect(() => {
    if (auto <= 0) return undefined;
    if (busy || bigWin) return undefined;
    if (bal < stake || msg) { setAuto(0); return undefined; }
    const t = window.setTimeout(() => { setAuto((a) => a - 1); void spin(); }, turbo ? 300 : 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, busy, bigWin, bal, stake, msg]);

  const top = Object.keys(game.paytable).filter((k) => k !== 'WILD');
  return (
    <div className={`sg-root rounded-2xl overflow-hidden relative${busy ? ' sg-busy' : ''}`} data-sgt={slotTheme(game.id)} style={{ background: `${artVer && getBg() ? `linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.55)), url(${getBg()}) center/cover, ` : ''}radial-gradient(900px 420px at 50% 0%, ${game.color[1]}cc, transparent 70%), linear-gradient(160deg, ${game.color[0]}, ${game.color[1]})` }}>
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => fmt(v, currency)} onDone={() => setBigWin(null)} />}
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="sg-cur">
            {(['ALL', 'EUR'] as const).filter((c) => accountCurrency === 'BOTH' || accountCurrency === c).map((c) => (
              <button key={c} onClick={() => switchCurrency(c)} className={currency === c ? 'on' : ''}>{c === 'ALL' ? 'L' : '€'}</button>
            ))}
          </div>
          <div className="sg-marquee !m-0" aria-hidden>{THEME_ORN[slotTheme(game.id)][0]} <span>{game.lines} LINES · {game.volatility}</span> {THEME_ORN[slotTheme(game.id)][1]}</div>
        </div>

        <div className="flex items-center gap-2">
<div className="flex-1 min-w-0 cabinet-glow sg-cabinet">
          {(() => {
            const cssReels = (
              <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${nReels}, minmax(0, 1fr))` }}>
                {grid.map((col, r) => (
                  <SlotReel key={r} symbols={col} spinning={spinning[r]} pool={Object.values(game.symbols)} litRows={[0, 1, 2].filter((row) => lit.has(`${r}-${row}`))} />
                ))}
              </div>
            );
            if (!use3d) return cssReels;
            return (
              <Suspense fallback={cssReels}>
                <Reels3D key={artVer} grid={grid} spinning={spinning} lit={lit} pool={Object.values(game.symbols)} colors={game.color as [string, string]} metal={THEME_METAL[slotTheme(game.id)]} onFail={() => setUse3d(false)} />
              </Suspense>
            );
          })()}
        </div>
          <SlotLever onPull={spin} disabled={busy || bal < stake} className="shrink-0 hidden sm:block" />
        </div>


        <div className="sg-stats">
          <div className="sg-stat"><label>Balance</label><b className="tabular-nums">{fmt(bal, currency)}</b></div>
          <div className={`sg-stat sg-stat-win${lastWin > 0 ? " on" : ""}`}><label>Win</label><b className="tabular-nums">{lastWin > 0 ? (busy ? fmt(lastWin, currency) : <span key={lastWin} className="win-pop inline-block"><CountUp value={lastWin} format={(n) => fmt(n, currency)} /></span>) : fmt(0, currency)}</b></div>
          <button className="sg-stat sg-stat-bet" onClick={() => setBetOpen(!betOpen)} disabled={busy}><label>Bet ✎</label><b className="tabular-nums">{fmt(stake, currency)}</b></button>
        </div>
        <div className="sg-ticker min-h-[22px] text-center">
          {freeInfo && <div className="text-xs font-bold text-cyan-300">{freeInfo}</div>}
          {msg && !lastWin && <div className="text-sm font-bold text-red-300">{msg}</div>}
        </div>

        {betOpen && <div className="mb-2"><StakeInput value={stake} onChange={setStake} min={stakes[currency][0]} max={currency === 'EUR' ? 10000000 : 100000000} presets={stakes[currency]} unit={currency === 'EUR' ? '€' : 'L'} balance={bal} disabled={busy} /></div>}

        <div className="sg-dock">
          <div className="sg-side">
            <button onClick={() => setShowPay(true)} className="sg-mini" aria-label="Paytable">i</button>
            <button onClick={() => setTurbo(!turbo)} className={`sg-mini ${turbo ? 'on' : ''}`} aria-label="Turbo">⚡</button>
          </div>
          <button className="sg-step" disabled={busy} onClick={() => stepBet(-1)} aria-label="Lower bet">−</button>
          <button onClick={spin} disabled={busy || bal < stake} className="sg-spin-round" aria-label="Spin">
            <span>{busy ? '' : '▶'}</span>
          </button>
          <button className="sg-step" disabled={busy} onClick={() => stepBet(1)} aria-label="Raise bet">+</button>
          <div className="sg-side">
            <button onClick={() => { if (auto > 0) setAuto(0); else if (!busy) setAuto(25); }} className={`sg-mini ${auto > 0 ? 'on' : ''}`} aria-label="Autoplay">{auto > 0 ? auto : 'A'}</button>
            <button onClick={() => { setSound(!snd); setSnd(!snd); }} aria-label="Sound" className="sg-mini">{snd ? '🔊' : '🔇'}</button>
          </div>
        </div>
        <div className="text-[10px] text-center text-gray-400 mt-3">3+ {game.symbols.SCATTER} ({game.scatterName}) = free spins · {game.symbols.WILD} ({game.wildName}) substitutes</div>
      </div>

      {showPay && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={() => setShowPay(false)}>
          <div className="bg-brand-panel rounded-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-4 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2"><b>{game.name} · Tabela e pagesave</b><button onClick={() => setShowPay(false)}>✕</button></div>
            <div className="text-[11px] text-gray-400 mb-3">Payouts are multiples of the bet per line (stake ÷ {game.lines}). Symbols: Twemoji (CC-BY 4.0).</div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-gray-400 text-xs"><th className="text-left">Simboli</th>{Array.from({ length: nReels - 2 }, (_, i) => <th key={i}>x{i + 3}</th>)}</tr></thead>
              <tbody>
                {[...top.reverse(), 'WILD'].map((k) => (
                  <tr key={k} className="border-t border-white/10"><td className="py-1"><span className="inline-block w-8 h-8"><SymbolIcon symbol={game.symbols[k]} className="w-full h-full" /></span></td>{Array.from({ length: nReels - 2 }, (_, i) => i + 3).map((n) => <td key={n} className="text-center tabular-nums">{game.paytable[k][n]}</td>)}</tr>
                ))}
                <tr className="border-t border-white/10"><td className="py-1"><span className="inline-block w-8 h-8"><SymbolIcon symbol={game.symbols.SCATTER} className="w-full h-full" /></span></td>{Array.from({ length: nReels - 2 }, (_, i) => i + 3).map((n) => <td key={n} className="text-center tabular-nums text-xs">{game.scatterPay[n]}× stake<br />{game.freeSpins[n]} free</td>)}</tr>
              </tbody>
            </table></div>
            <div className="text-[11px] text-gray-400 mt-3">Free spins pay x{game.freeSpinMultiplier}.{game.wildExpand ? ' Wild expands over the whole reel.' : ''} Maximum win per round: 2000× stake.</div>
          </div>
        </div>
      )}
    </div>
  );
};

function idleGrid(game: api.VideoSlotInfo): string[][] {
  const base = Object.keys(game.symbols).filter((k) => k !== 'WILD' && k !== 'SCATTER');
  return Array.from({ length: game.reels ?? 5 }, (_, r) => [0, 1, 2].map((row) => game.symbols[base[(r * 3 + row) % base.length]]));
}

export default SlotGames;
