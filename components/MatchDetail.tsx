import React, { useState, useMemo, useEffect } from 'react';
import { Match, MatchStatus } from '../types';
import * as api from '../services/api';
import type { LiveStatistics, MatchEvent } from '../services/api';
import LivePitch from './LivePitch';

interface MatchDetailProps {
  match: Match;
  onClose: () => void;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  selectedIds: string[];
}

const EVENT_LABELS: Record<string, string> = {
  GOAL: '⚽ Gol',
  YELLOW_CARD: '🟨 Kartonë i verdhë',
  RED_CARD: '🟥 Kartonë i kuq',
  SUBSTITUTION: '🔄 Zëvendësim',
  CORNER: '🚩 Korner',
  VAR: '📺 VAR',
};

const StatBar: React.FC<{ label: string; home: number | null; away: number | null; suffix?: string }> = ({ label, home, away, suffix = '' }) => {
  const h = home ?? 0;
  const a = away ?? 0;
  const total = h + a || 1;
  if (home == null && away == null) return null;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-white font-bold mb-1">
        <span>{home ?? '-'}{suffix}</span>
        <span className="text-brand-textMuted font-normal uppercase">{label}</span>
        <span>{away ?? '-'}{suffix}</span>
      </div>
      <div className="flex h-1.5 rounded overflow-hidden bg-[#444]">
        <div className="bg-brand-accent" style={{ width: `${(h / total) * 100}%` }} />
        <div className="bg-brand-yellow" style={{ width: `${(a / total) * 100}%` }} />
      </div>
    </div>
  );
};

const MatchDetail: React.FC<MatchDetailProps> = ({ match, onClose, onBetClick, selectedIds }) => {
  const isFinished = match.status === MatchStatus.FINISHED;
  const hasLiveData = match.status === MatchStatus.LIVE || isFinished;
  const [activeTab, setActiveTab] = useState<string>('All');
  const [liveDetail, setLiveDetail] = useState<{ statistics: LiveStatistics | null; events: MatchEvent[] } | null>(null);
  const [liveDetailLoading, setLiveDetailLoading] = useState(false);

  // Odds-movement arrows: remember the last-seen price per option id, and
  // flag a direction ('up' | 'down') for a couple seconds after any change
  // so the UI can flash a green/red arrow next to the odds that just moved.
  const prevOddsRef = React.useRef<Map<string, number>>(new Map());
  const [oddsFlash, setOddsFlash] = useState<Map<string, 'up' | 'down'>>(new Map());

  useEffect(() => {
    const prev = prevOddsRef.current;
    const nextFlash = new Map<string, 'up' | 'down'>();
    let changed = false;
    for (const market of match.markets) {
      for (const opt of market.options) {
        const key = `${market.id}-${opt.id}`;
        const last = prev.get(key);
        if (last != null && last !== opt.odds) {
          nextFlash.set(key, opt.odds > last ? 'up' : 'down');
          changed = true;
        }
        prev.set(key, opt.odds);
      }
    }
    if (changed) {
      setOddsFlash(nextFlash);
      const t = setTimeout(() => setOddsFlash(new Map()), 2500);
      return () => clearTimeout(t);
    }
  }, [match.markets]);

  useEffect(() => {
    if (!hasLiveData) { setLiveDetail(null); return; }
    let cancelled = false;
    setLiveDetailLoading(true);
    api.fetchMatchLiveDetail(match.id)
      .then((d) => { if (!cancelled) setLiveDetail(d); })
      .catch(() => { if (!cancelled) setLiveDetail({ statistics: null, events: [] }); })
      .finally(() => { if (!cancelled) setLiveDetailLoading(false); });
    return () => { cancelled = true; };
  }, [match.id, hasLiveData]);

  const CATEGORY_LABELS: Record<string, string> = {
    All: 'Kryesore',
    main: '45/90',
    goals: 'Golat',
    btts: 'Gol/JoGol',
    handicap: 'Azian',
    cards: 'Kartona',
    corners: 'Korne',
    scorers: 'Golashenues',
    other: 'Speciale',
  };

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set(match.markets.map(m => m.category || 'other'));
    return ['All', ...Array.from(cats).sort()];
  }, [match]);

  const filteredMarkets = match.markets.filter(m => activeTab === 'All' || m.category === activeTab);

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    
    // Standard odds block style
    const base = "flex items-center justify-center gap-2 py-3 px-2 cursor-pointer transition-colors text-center";
    if (isFinished) return `${base} opacity-50 cursor-default bg-[#4a4a4a] text-brand-textMuted`;
    if (isSelected) return `${base} bg-brand-yellow text-brand-headerDark font-bold`;
    return `${base} bg-[#4a4a4a] hover:bg-[#565656] text-brand-text`;
  };

  return (
    <div className="bg-brand-bg text-brand-text h-full flex flex-col">
      {/* Match Header */}
      <div className="bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] bg-brand-headerDark/30 p-6 relative border-b border-brand-divider">
        <button onClick={onClose} className="absolute top-4 left-4 text-brand-textMuted hover:text-white text-xs font-bold flex items-center gap-1">
          ‹ Soccer
        </button>
        
        <div className="mt-4 text-center">
             <div className="text-xs text-brand-textMuted uppercase tracking-wider mb-2">{match.league}</div>
             {match.status === MatchStatus.LIVE && (
               <div className="mb-4">
                 <LivePitch match={match} stats={liveDetail?.statistics ?? null} />
               </div>
             )}
             <div className="flex justify-center items-center gap-8">
                 <div className="text-2xl font-bold text-white">{match.homeTeam}</div>
                 <div className="text-3xl text-brand-yellow font-mono">
                    {isFinished ? `${match.score?.home} - ${match.score?.away}` : 'v'}
                 </div>
                 <div className="text-2xl font-bold text-white">{match.awayTeam}</div>
             </div>
             {isFinished && (
                <div className="mt-2 text-xs text-brand-accent">
                    FT | HT: {match.score?.htHome}-{match.score?.htAway} | Corners: {match.score?.homeCorners}-{match.score?.awayCorners}
                </div>
             )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="bg-[#333] border-b border-brand-divider overflow-x-auto no-scrollbar">
         <div className="flex">
            {hasLiveData && (
              <>
                <button
                    onClick={() => setActiveTab('STATS')}
                    className={`px-4 py-3 text-xs font-bold uppercase transition-colors whitespace-nowrap ${
                        activeTab === 'STATS'
                        ? 'text-brand-yellow border-b-2 border-brand-yellow bg-[#3a3a3a]'
                        : 'text-brand-textMuted hover:text-white hover:bg-[#3a3a3a]'
                    }`}
                >
                    Statistika
                </button>
                <button
                    onClick={() => setActiveTab('EVENTS')}
                    className={`px-4 py-3 text-xs font-bold uppercase transition-colors whitespace-nowrap ${
                        activeTab === 'EVENTS'
                        ? 'text-brand-yellow border-b-2 border-brand-yellow bg-[#3a3a3a]'
                        : 'text-brand-textMuted hover:text-white hover:bg-[#3a3a3a]'
                    }`}
                >
                    Ngjarjet
                </button>
              </>
            )}
            {categories.map(cat => (
                <button
                    key={cat}
                    onClick={() => setActiveTab(cat)}
                    className={`px-4 py-3 text-xs font-bold uppercase transition-colors whitespace-nowrap ${
                        activeTab === cat 
                        ? 'text-brand-yellow border-b-2 border-brand-yellow bg-[#3a3a3a]' 
                        : 'text-brand-textMuted hover:text-white hover:bg-[#3a3a3a]'
                    }`}
                >
                    {CATEGORY_LABELS[cat] || cat}
                </button>
            ))}
         </div>
      </div>

      {/* Stats / Events / Markets Content */}
      {activeTab === 'STATS' ? (
        <div className="p-4 overflow-y-auto flex-1 bg-[#282828]">
          {liveDetailLoading ? (
            <div className="text-center text-brand-textMuted text-xs py-8">Duke ngarkuar statistikat...</div>
          ) : !liveDetail?.statistics ? (
            <div className="text-center text-brand-textMuted text-xs py-8">
              Statistika live s'janë të disponueshme për këtë ndeshje.
            </div>
          ) : (
            <div>
              <div className="text-[10px] text-brand-textMuted uppercase text-center mb-4">
                DEMO / SIMULIM — statistika nga burimi i të dhënave, jo verifikim zyrtar
              </div>
              <StatBar label="Posedimi" home={liveDetail.statistics.possession_home} away={liveDetail.statistics.possession_away} suffix="%" />
              <StatBar label="Gjuajtje" home={liveDetail.statistics.shots_home} away={liveDetail.statistics.shots_away} />
              <StatBar label="Gjuajtje në portë" home={liveDetail.statistics.shots_on_target_home} away={liveDetail.statistics.shots_on_target_away} />
              <StatBar label="Korner" home={liveDetail.statistics.corners_home} away={liveDetail.statistics.corners_away} />
              <StatBar label="Kartonë" home={liveDetail.statistics.cards_home} away={liveDetail.statistics.cards_away} />
              <StatBar label="xG" home={liveDetail.statistics.xg_home} away={liveDetail.statistics.xg_away} />
            </div>
          )}
        </div>
      ) : activeTab === 'EVENTS' ? (
        <div className="p-4 overflow-y-auto flex-1 bg-[#282828]">
          {liveDetailLoading ? (
            <div className="text-center text-brand-textMuted text-xs py-8">Duke ngarkuar ngjarjet...</div>
          ) : !liveDetail?.events.length ? (
            <div className="text-center text-brand-textMuted text-xs py-8">Ende s'ka ngjarje të regjistruara.</div>
          ) : (
            <div className="space-y-2">
              {liveDetail.events.map((ev, i) => (
                <div key={i} className="flex items-center gap-3 bg-[#333] rounded px-3 py-2">
                  <span className="text-brand-yellow font-mono text-xs w-8 shrink-0">{ev.minute != null ? `${ev.minute}'` : '-'}</span>
                  <span className="text-white text-xs flex-1">{EVENT_LABELS[ev.type] || ev.type}</span>
                  {ev.team && <span className="text-brand-textMuted text-[10px]">{ev.team}</span>}
                  {ev.player && <span className="text-brand-textMuted text-[10px]">{ev.player}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="p-2 space-y-2 overflow-y-auto flex-1 bg-[#282828]">
        {filteredMarkets.map(market => {
            const cols = Math.min(market.options.length, 3) || 1;
            return (
            <div key={market.id} className="overflow-hidden mb-2">
                <div className="bg-brand-header px-3 py-2 text-xs font-bold text-white">
                    {market.name}
                </div>
                <div
                    className="grid gap-px bg-brand-bg"
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                    {market.options.map(opt => {
                        const isSelected = selectedIds.includes(`${match.id}-${market.id}-${opt.id}`);
                        const flash = oddsFlash.get(`${market.id}-${opt.id}`);
                        return (
                        <div
                            key={opt.id}
                            onClick={() => !isFinished && onBetClick(match, market.id, opt.id)}
                            className={getButtonClass(market.id, opt.id)}
                        >
                            <span className={`text-xs ${isSelected ? 'text-brand-headerDark' : 'text-brand-text'}`}>{opt.name}</span>
                            <span className={`font-bold text-sm flex items-center gap-0.5 ${isSelected ? 'text-brand-headerDark' : 'text-brand-yellow'}`}>
                              {opt.odds.toFixed(2)}
                              {flash === 'up' && <span className="text-[10px] text-green-400">▲</span>}
                              {flash === 'down' && <span className="text-[10px] text-red-400">▼</span>}
                            </span>
                        </div>
                        );
                    })}
                </div>
            </div>
            );
        })}
      </div>
      )}
    </div>
  );
};

export default MatchDetail;