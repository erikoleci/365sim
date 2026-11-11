import React, { useEffect, useMemo, useState } from 'react';
import './lobby.css';
import { CATEGORIES, Category, LIVE_TILES, TILES, Tile } from './catalog';
import { WheelCover, KenoCover, ScratchCover, TumbleCover } from '../CasinoCovers';
import LiveWins from '../LiveWins';
import SlotGames from '../SlotGames';

const ART: Record<string, React.ReactNode> = { wheel: <WheelCover />, keno: <KenoCover />, scratch: <ScratchCover />, tumble: <TumbleCover /> };
const FEATURED: { key: string; title: string; line: string }[] = [
  { key: 'slots', title: 'Super Slots', line: '30 themed machines. Free spins, wilds and big-win moments.' },
  { key: 'crash', title: 'Crash', line: 'The multiplier climbs. Cash out before it flies away.' },
  { key: 'dogs', title: 'Dog Race', line: 'Six greyhounds, one finish line. Pick your runner.' },
  { key: 'roulette', title: 'Roulette', line: 'The classic European wheel, single zero.' },
];

export interface LobbyProps {
  balance: number; balanceEur: number; currency: 'ALL' | 'EUR' | 'BOTH';
  isOpen: (key: string) => boolean; onPlay: (t: Tile) => void;
  slotsProps: React.ComponentProps<typeof SlotGames>;
}

const fmt = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const GameCard: React.FC<{ t: Tile; i: number; onPlay: (t: Tile) => void }> = ({ t, i, onPlay }) => {
  const src = t.img ? `/casino/${t.img}.jpg` : undefined;
  return (
    <button onClick={() => onPlay(t)} aria-label={t.name} className="lb-card lb-rise group" style={{ ['--acc' as string]: t.accent, animationDelay: `${Math.min(i, 12) * 40}ms` } as React.CSSProperties}>
      <div className="lb-media">
        {t.badge && <span className="lb-badge" data-k={t.badge}>{t.badge === 'LIVE' && <i className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}{t.badge}</span>}
        {src ? (t.wide ? (<><div className="lb-bgblur" style={{ backgroundImage: `url(${src})` }} /><img className="fit" src={src} alt="" loading="lazy" draggable={false} /></>) : <img className="fill" src={src} alt="" loading="lazy" draggable={false} />)
          : <div className="lb-art">{t.art && ART[t.art]}</div>}
        <span className="lb-play" aria-hidden>▶</span>
      </div>
      <div className="lb-info"><b>{t.name}</b><span>{t.tagline}</span></div>
    </button>
  );
};

const Hero: React.FC<{ onPlay: (t: Tile) => void; isOpen: (k: string) => boolean }> = ({ onPlay, isOpen }) => {
  const items = useMemo(() => FEATURED.map((f) => ({ f, t: TILES.find((x) => x.key === f.key)! })).filter((x) => x.t && isOpen(x.t.key)), [isOpen]);
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold || items.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => setI((v) => (v + 1) % items.length), 5500);
    return () => window.clearInterval(id);
  }, [hold, items.length]);
  if (!items.length) return null;
  return (
    <section className="lb-hero" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onTouchStart={() => setHold(true)} aria-roledescription="carousel" aria-label="Featured games">
      {items.map(({ f, t }, n) => (
        <div key={f.key} className="lb-hero-slide" data-on={n === i ? 1 : 0} aria-hidden={n !== i} style={{ ['--acc' as string]: t.accent } as React.CSSProperties}>
          <div className="lb-hero-bg" style={{ backgroundImage: `url(/casino/${t.img}.jpg)` }} />
          <div className="lb-hero-shade" />
          <div className="relative z-10 h-full flex flex-col justify-center p-6 pb-12 sm:p-10 sm:pb-12 max-w-[62%] sm:max-w-[58%]" style={{ minHeight: 300 }}>
            <span className="text-[11px] font-black tracking-[.2em] text-[color:var(--lb-em)] mb-2" style={{ color: '#26ffbe' }}>FEATURED</span>
            <h2 className="lb-serif lb-foil text-4xl sm:text-6xl font-black leading-[1.02] mb-3">{f.title}</h2>
            <p className="text-sm sm:text-base text-slate-300 mb-5 max-w-md">{f.line}</p>
            <div><button className="lb-cta" tabIndex={n === i ? 0 : -1} onClick={() => onPlay(t)}>▶ Play now</button></div>
          </div>
          <div className="lb-hero-art"><img src={`/casino/${t.img}.jpg`} alt="" draggable={false} /></div>
        </div>
      ))}
      <div className="absolute z-20 bottom-4 left-6 sm:left-10 flex gap-1.5">
        {items.map((x, n) => <button key={x.f.key} aria-label={`Show ${x.f.title}`} className="lb-dot" data-on={n === i ? 1 : 0} onClick={() => setI(n)} />)}
      </div>
    </section>
  );
};

const Lobby: React.FC<LobbyProps> = ({ balance, balanceEur, currency, isOpen, onPlay, slotsProps }) => {
  const [cat, setCat] = useState<Category>('all');
  const [q, setQ] = useState('');
  const all = useMemo(() => [...TILES, ...LIVE_TILES].filter((t) => isOpen(t.key)), [isOpen]);
  const query = q.trim().toLowerCase();
  const shown = all.filter((t) => (cat === 'all' || t.cat === cat) && (!query || t.name.toLowerCase().includes(query) || t.tagline.toLowerCase().includes(query)));
  const grid = (list: Tile[]) => <div className="lb-grid">{list.map((t, n) => <GameCard key={t.key} t={t} i={n} onPlay={onPlay} />)}</div>;
  const groups: { title: string; cat: Tile['cat'] }[] = [{ title: 'Slots', cat: 'slots' }, { title: 'Racing & Sport', cat: 'race' }, { title: 'Instant games', cat: 'instant' }, { title: 'Table games', cat: 'table' }, { title: 'Live casino', cat: 'live' }];
  const showSlotsLobby = (cat === 'all' || cat === 'slots') && !query && isOpen('slots');

  return (
    <div className="lb">
      <header className="flex items-center justify-between gap-3 mb-5">
        <div className="lb-logo">
          <div className="lb-logo-mark">365</div>
          <div className="leading-tight"><div className="lb-serif lb-foil text-lg sm:text-3xl font-black tracking-wide whitespace-nowrap">365SIM CASINO</div><div className="text-[10px] sm:text-[11px] text-slate-400 whitespace-nowrap">Demo credits · no real money</div></div>
        </div>
        <div className="lb-balance lb-glass" aria-label="Balance">
          <span className="text-xl" aria-hidden>🪙</span>
          <div><div className="text-[10px] uppercase tracking-widest text-slate-400">Balance</div>
            <div className="lb-balance-v lb-foil">{currency === 'EUR' ? `${fmt(balanceEur)} €` : `${fmt(balance)} L`}{currency === 'BOTH' && balanceEur > 0 && <span className="text-slate-300 text-xs ml-2" style={{ WebkitTextFillColor: '#cbd5e1' }}>{fmt(balanceEur)} €</span>}</div></div>
        </div>
      </header>

      <Hero onPlay={onPlay} isOpen={isOpen} />

      <div className="flex flex-col md:flex-row md:items-center gap-3 mt-6">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 flex-1" role="tablist" style={{ scrollbarWidth: 'none' }}>
          {CATEGORIES.map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)} className="lb-chip lb-glass">
              {c.id === 'live' ? <i className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> : <span aria-hidden>{c.icon}</span>}{c.label}
            </button>
          ))}
        </div>
        <input className="lb-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search games" aria-label="Search games" />
      </div>

      {cat === 'live' && !query && <div className="mt-5"><LiveWins /></div>}

      {cat === 'all' && !query
        ? groups.map((g) => { const l = shown.filter((t) => t.cat === g.cat); return l.length ? (
            <section key={g.cat}><h3 className="lb-sec"><span className="lb-serif lb-foil text-2xl font-black">{g.title}</span><span className="text-xs text-slate-400">{l.length} games</span></h3>{grid(l)}
              {g.cat === 'slots' && showSlotsLobby && <div className="mt-6"><SlotGames {...slotsProps} /></div>}</section>) : null; })
        : <div className="mt-6">{shown.length ? grid(shown) : <div className="text-center text-slate-400 py-16">No games found.</div>}
            {cat === 'slots' && showSlotsLobby && <div className="mt-6"><SlotGames {...slotsProps} /></div>}</div>}
      {cat === 'all' && !query && <div className="mt-8"><LiveWins /></div>}
    </div>
  );
};
export default Lobby;
