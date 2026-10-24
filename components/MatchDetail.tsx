import React, { useState, useMemo, useEffect } from 'react';
import { Match, MatchStatus } from '../types';
import * as api from '../services/api';
import type { LiveStatistics, MatchEvent } from '../services/api';
import LivePitch from './LivePitch';
import { useTickingClock, formatLiveClock } from './MatchCard';
import { isHalftime, liveMinuteFallback, formatScore, pickClockSource, isLiveClockStale } from '../utils/liveStatus';
import { LONDON365_EVENT_LABELS, LONDON365_STAT_LABELS } from '../utils/london365Labels';
import { useI18n } from '../i18n';
import TeamLogo from './TeamLogo';

interface MatchDetailProps {
  match: Match;
  leagueLabel: string;
  onClose: () => void;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  selectedIds: string[];
}

// GOAL/YELLOW_CARD/RED_CARD are OUR internal match_events.type enum (set by
// applyGameDetails on the backend) — kept as-is for consistency with
// settlement/other code that reads this column. Only the DISPLAY text here
// is aligned to the provider's own confirmed wording (LONDON365_EVENT_LABELS,
// captured verbatim from a real socket payload — see utils/london365Labels.ts)
// instead of an invented label. The rest of that dictionary (Pushim,
// Ndeshja_Mbaroi, Sulm, Zoteron_topin, etc.) is included so it renders
// correctly the moment a real feed for those event types is identified —
// none of them are emitted by anything today, so they simply never appear.
const EVENT_LABELS: Record<string, string> = {
  GOAL: `⚽ ${LONDON365_EVENT_LABELS.Gol}`,
  YELLOW_CARD: `🟨 ${LONDON365_EVENT_LABELS.Karton_i_verdhe}`,
  RED_CARD: `🟥 ${LONDON365_EVENT_LABELS.Karton_i_kuq}`,
  SUBSTITUTION: `🔄 ${LONDON365_EVENT_LABELS.Nderrim}`,
  CORNER: `🚩 ${LONDON365_EVENT_LABELS.Korne}`,
  VAR: `📺 ${LONDON365_EVENT_LABELS.VAR}`,
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

const STAT_FIELDS = ['possession_home', 'shots_home', 'shots_on_target_home', 'corners_home', 'cards_home', 'xg_home', 'possession_away', 'shots_away', 'shots_on_target_away', 'corners_away', 'cards_away', 'xg_away'];

// A market option that IS one of the two teams ("Arsenal", or "Arsenal (-1)" in a handicap) gets that
// team's crest in front; every other option (1, X, Over 2.5, ...) is drawn exactly as before.
const OptionName: React.FC<{ match: Match; name: string; tn: (text: string) => string }> = ({ match, name, tn }) => {
  const lower = name.trim().toLowerCase();
  const isTeam = (team: string) => lower === team.toLowerCase() || lower.startsWith(`${team.toLowerCase()} (`);
  const team = isTeam(match.homeTeam) ? match.homeTeam : isTeam(match.awayTeam) ? match.awayTeam : null;
  if (!team) return <>{tn(name)}</>;
  return (
    <span className="inline-flex items-center justify-center gap-1">
      <TeamLogo name={team} league={match.league} providerLogo={team === match.homeTeam ? match.homeTeamLogo : match.awayTeamLogo} size="xs" />
      <span>{tn(name)}</span>
    </span>
  );
};

const MatchDetail: React.FC<MatchDetailProps> = ({ match, leagueLabel, onClose, onBetClick, selectedIds }) => {
  const { t, tn } = useI18n();
  const isFinished = match.status === MatchStatus.FINISHED;
  const isLive = match.status === MatchStatus.LIVE;
  const hasLiveData = isLive || isFinished;
  // Same per-second ticking clock as the match list/pitch view — shown right
  // in the header (next to the score) so it's visible the moment the page
  // opens, instead of only inside the pitch box further down, and so it
  // never looks frozen on whatever minute it happened to load at (e.g. "93'"
  // sitting still) between the 15s poll/socket refreshes.
  const [activeTab, setActiveTab] = useState<string>('All');
  const [liveDetail, setLiveDetail] = useState<{ statistics: LiveStatistics | null; events: MatchEvent[] } | null>(null);
  const [liveDetailLoading, setLiveDetailLoading] = useState(false);
  const [cardFlash, setCardFlash] = useState<{ kind: 'YELLOW_CARD' | 'RED_CARD'; team: 'home' | 'away' } | null>(null);
  // The provider rarely sends statistics (possession, shots, corners, xG...). When none arrived
  // the "Statistika" tab would only ever say "not available", so the tab is not shown at all.
  const hasAnyStat = !!liveDetail?.statistics && STAT_FIELDS.some((k) => (liveDetail.statistics as any)[k] != null);
  useEffect(() => {
    if (activeTab === 'STATS' && !liveDetailLoading && !hasAnyStat) setActiveTab(hasLiveData ? 'EVENTS' : 'All');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, liveDetailLoading, hasAnyStat]);
  const clockSrc = pickClockSource(match, liveDetail?.statistics);
  const headerClock = useTickingClock(
    clockSrc.raw,
    clockSrc.stamp,
    match.status === MatchStatus.LIVE && !isHalftime(match),
    clockSrc.estimated
  );

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
      const flashTimer = setTimeout(() => setOddsFlash(new Map()), 2500);
      return () => clearTimeout(flashTimer);
    }
  }, [match.markets]);

  useEffect(() => {
    if (!hasLiveData) { setLiveDetail(null); return; }
    let cancelled = false;
    // `initial`: only the first load shows the "Duke ngarkuar..." spinner. The 15s poll and the
    // socket refreshes replace the data silently, and a failed refresh keeps what is on screen
    // (it used to blank the events list / stats every time one poll failed or reloaded).
    const load = (initial = false) => {
      if (initial) setLiveDetailLoading(true);
      api.fetchMatchLiveDetail(match.liveSourceId ?? match.id)
        .then((d) => { if (!cancelled) setLiveDetail(d); })
        .catch(() => { if (!cancelled) setLiveDetail((prev) => prev ?? { statistics: null, events: [] }); })
        .finally(() => { if (!cancelled && initial) setLiveDetailLoading(false); });
    };
    load(true);
    // Live games: keep stats, events, minute and odds fresh on their own
    // cadence while the detail panel is open, without any manual refresh.
    // This polling interval is only the fallback safety net — the socket
    // subscription below is the real-time path and fires immediately on
    // every goal/card, same as the provider's own feed.
    const interval = match.status === MatchStatus.LIVE ? setInterval(() => load(), 15000) : null;
    const onVisible = () => { if (document.visibilityState !== 'hidden') load(); }; // back from the background
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);

    let socket: WebSocket | null = null;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    if (match.status === MatchStatus.LIVE) {
      socket = new WebSocket(api.getWsUrl());
      socket.onopen = () => socket!.send(JSON.stringify({ type: 'subscribe', topic: `match:${match.liveSourceId ?? match.id}` }));
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'CARD' && (msg.cardType === 'YELLOW_CARD' || msg.cardType === 'RED_CARD') && (msg.team === 'home' || msg.team === 'away')) {
            setCardFlash({ kind: msg.cardType, team: msg.team });
            if (flashTimer) clearTimeout(flashTimer);
            flashTimer = setTimeout(() => setCardFlash(null), 7000);
          }
          if (msg.type === 'GOAL' || msg.type === 'GOAL_DISALLOWED' || msg.type === 'CARD' || msg.type === 'MATCH_ENDED') load();
        } catch { /* ignore malformed message */ }
      };
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      if (flashTimer) clearTimeout(flashTimer);
      socket?.close();
    };
  }, [match.id, hasLiveData, match.status]);

  // Index in the events list where "Fundi i pjesës së parë" goes: before the
  // first event after minute 45, or at the end when the match has reached the
  // second half / finished but nothing happened after the break yet. null
  // while the first half is still being played.
  const firstHalfDividerAt = useMemo(() => {
    const evs = liveDetail?.events ?? [];
    const minuteNow = Number(liveDetail?.statistics?.minute ?? String(match.currentMinute ?? '').match(/^\d+/)?.[0] ?? NaN);
    const reachedSecondHalf = isHalftime(match) || isFinished || (Number.isFinite(minuteNow) && minuteNow > 45) || evs.some((e) => e.minute != null && e.minute > 45);
    if (!reachedSecondHalf || !evs.some((e) => e.minute != null && e.minute <= 45)) return null;
    const idx = evs.findIndex((e) => e.minute != null && e.minute > 45);
    return idx === -1 ? evs.length : idx;
  }, [liveDetail, isFinished, match.currentMinute, match.liveStatus]);

  const CATEGORY_LABELS: Record<string, string> = {
    All: t('Të Gjitha'),
    main: t('Kryesore'),
    goals: t('Golat'),
    btts: t('Gol/JoGol'),
    handicap: t('Hendikep'),
    cards: t('Kartona'),
    corners: t('Korne'),
    scorers: t('Golashenues'),
    other: t('Speciale'),
  };

  // Extract unique categories in provider order (Kryesore first, then the
  // rest exactly as the source lists them) — never alphabetically sorted,
  // so the tab strip mirrors the real bookmaker layout. A category only
  // gets a tab if it actually has at least one non-suspended option right
  // now; a tab that opens to nothing but locked/greyed markets is dead
  // weight, not a real choice.
  const categories = useMemo(() => {
    const cats = new Set(
      match.markets
        .filter(m => m.options.some(o => !o.suspended))
        .map(m => m.category || 'other')
    );
    return ['All', ...Array.from(cats)];
  }, [match]);

  // Closed (suspended) options and options without a price are not shown at all, and a market left
  // with nothing open disappears with them -- no lock icons, no greyed-out cells.
  const filteredMarkets = match.markets
    .filter(m => activeTab === 'All' || m.category === activeTab)
    .map(m => ({ ...m, options: m.options.filter(o => !o.suspended && o.odds > 0) }))
    .filter(m => m.options.length > 0);

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
      {/* Phone: a clear back bar (the small "‹ Soccer" link below is hidden under the FUTBOLL menu
          button on narrow screens) plus a floating pill that stays visible while scrolling markets.
          Both go back through the browser history, same as the phone's own back button; the bet
          slip selections stay as they were. */}
      <div className="md:hidden flex items-center gap-2 bg-[#1f1f1f] border-b border-brand-divider px-3 py-2">
        <button onClick={onClose} className="flex items-center gap-1 bg-brand-yellow text-black font-bold text-sm px-4 min-h-[44px] rounded">
          <span aria-hidden="true">←</span> {t('Kthehu')}
        </button>
        <span className="text-xs text-brand-textMuted truncate">{match.homeTeam} v {match.awayTeam}</span>
      </div>
      <button onClick={onClose} aria-label={t('Kthehu')} className="md:hidden fixed bottom-4 left-4 z-40 flex items-center gap-1 bg-brand-yellow text-black font-bold text-sm px-4 min-h-[48px] rounded-full shadow-2xl border-2 border-white">
        <span aria-hidden="true">←</span> {t('Kthehu')}
      </button>
      {/* Match Header */}
      <div className="bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] bg-brand-headerDark/30 p-6 relative border-b border-brand-divider">
        <button onClick={onClose} className="absolute top-4 left-4 text-brand-textMuted hover:text-white text-xs font-bold flex items-center gap-1">
          ‹ Soccer
        </button>
        
        <div className="mt-4 text-center">
             <div className="text-xs text-brand-textMuted uppercase tracking-wider mb-2">{leagueLabel}</div>
             {isLive && (
               <div className={`inline-block mb-2 text-xs font-bold px-3 py-1 rounded-full ${isHalftime(match) ? 'bg-brand-yellow text-black' : 'bg-brand-accent/90 text-black'}`}>
                 {isHalftime(match) ? t('Pushim') : headerClock ? `${formatLiveClock(headerClock)} · ${t(headerClock.half)}` : liveMinuteFallback(match)}
                 {isLiveClockStale(match) && <span title={t('Pa përditësim nga provider-i')} className="ml-1 text-amber-400">●</span>}
               </div>
             )}
             {isLive && (
               <div className="mb-4">
                 <LivePitch match={match} stats={liveDetail?.statistics ?? null} flash={cardFlash} />
               </div>
             )}
             <div className="flex justify-center items-center gap-8">
                 <div className="flex flex-col items-center gap-1">
                   <TeamLogo name={match.homeTeam} league={match.league} providerLogo={match.homeTeamLogo} size="xl" />
                   <div className="text-2xl font-bold text-white">{match.homeTeam}</div>
                 </div>
                 <div className="text-3xl text-brand-yellow font-mono">
                    {isFinished
                      ? `${match.score?.home} - ${match.score?.away}`
                      : isLive
                        ? `${formatScore(match.liveHomeScore)} - ${formatScore(match.liveAwayScore)}`
                        : 'v'}
                 </div>
                 <div className="flex flex-col items-center gap-1">
                   <TeamLogo name={match.awayTeam} league={match.league} providerLogo={match.awayTeamLogo} size="xl" />
                   <div className="text-2xl font-bold text-white">{match.awayTeam}</div>
                 </div>
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
                {hasAnyStat && (
                <button
                    onClick={() => setActiveTab('STATS')}
                    className={`px-4 py-3 text-xs font-bold uppercase transition-colors whitespace-nowrap ${
                        activeTab === 'STATS'
                        ? 'text-brand-yellow border-b-2 border-brand-yellow bg-[#3a3a3a]'
                        : 'text-brand-textMuted hover:text-white hover:bg-[#3a3a3a]'
                    }`}
                >
                    {t('Statistika')}
                </button>
                )}
                <button
                    onClick={() => setActiveTab('EVENTS')}
                    className={`px-4 py-3 text-xs font-bold uppercase transition-colors whitespace-nowrap ${
                        activeTab === 'EVENTS'
                        ? 'text-brand-yellow border-b-2 border-brand-yellow bg-[#3a3a3a]'
                        : 'text-brand-textMuted hover:text-white hover:bg-[#3a3a3a]'
                    }`}
                >
                    {t('Ngjarjet')}
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
            <div className="text-center text-brand-textMuted text-xs py-8">{t('Duke ngarkuar statistikat...')}</div>
          
          ) : !liveDetail?.statistics || !STAT_FIELDS.some((k) => (liveDetail.statistics as any)[k] != null) ? (
            <div className="text-center text-brand-textMuted text-xs py-8">
              {t("Statistika live s'janë të disponueshme për këtë ndeshje.")}
            </div>
          ) : (
            <div>
              <div className="text-[10px] text-brand-textMuted uppercase text-center mb-4">
                {t('Statistika nga burimi i të dhënave — jo verifikim zyrtar')}
              </div>
              <StatBar label={t(LONDON365_STAT_LABELS.Statistika_ZoterimTopi.replace(' %', ''))} home={liveDetail.statistics.possession_home} away={liveDetail.statistics.possession_away} suffix="%" />
              <StatBar label={t(LONDON365_STAT_LABELS.Statistika_Goditje_ne_porte)} home={liveDetail.statistics.shots_on_target_home} away={liveDetail.statistics.shots_on_target_away} />
              <StatBar label={t(LONDON365_STAT_LABELS.Statistika_Goditje_jasht_porte)} home={liveDetail.statistics.shots_home != null && liveDetail.statistics.shots_on_target_home != null ? liveDetail.statistics.shots_home - liveDetail.statistics.shots_on_target_home : null} away={liveDetail.statistics.shots_away != null && liveDetail.statistics.shots_on_target_away != null ? liveDetail.statistics.shots_away - liveDetail.statistics.shots_on_target_away : null} />
              <StatBar label={t('Korne')} home={liveDetail.statistics.corners_home} away={liveDetail.statistics.corners_away} />
              <StatBar label={t('Kartonë')} home={liveDetail.statistics.cards_home} away={liveDetail.statistics.cards_away} />
              <StatBar label="xG" home={liveDetail.statistics.xg_home} away={liveDetail.statistics.xg_away} />
            </div>
          )}
        </div>
      ) : activeTab === 'EVENTS' ? (
        <div className="p-4 overflow-y-auto flex-1 bg-[#282828]">
          {liveDetailLoading ? (
            <div className="text-center text-brand-textMuted text-xs py-8">{t('Duke ngarkuar ngjarjet...')}</div>
          ) : !liveDetail?.events.length ? (
            <div className="text-center text-brand-textMuted text-xs py-8 px-4">
              {(match.liveHomeScore ?? 0) + (match.liveAwayScore ?? 0) > 0
                ? t('Rezultati është {score}. Provider-i jep vetëm rezultatin: golashënuesit dhe minutat e golave nuk janë të disponueshme.', { score: `${formatScore(match.liveHomeScore)} - ${formatScore(match.liveAwayScore)}` })
                : t("Ende s'ka ngjarje të regjistruara.")}
            </div>
          ) : (
            <div className="space-y-2">
              {liveDetail.events.map((ev, i) => (
                <React.Fragment key={i}>
                {i === firstHalfDividerAt && (
                  <div className="text-center text-brand-yellow text-xs font-bold py-2">{t('Fundi i pjesës së parë')}</div>
                )}
                <div className="flex items-center gap-3 bg-[#333] rounded px-3 py-2">
                  <span className="text-brand-yellow font-mono text-xs w-8 shrink-0">{ev.minute != null ? `${ev.minute}'` : '-'}</span>
                  <span className="text-white text-xs flex-1">{EVENT_LABELS[ev.type] ? t(EVENT_LABELS[ev.type]) : ev.type}</span>
                  {ev.team && <span className="text-brand-textMuted text-[10px]">{ev.team}</span>}
                  {ev.player && <span className="text-brand-textMuted text-[10px]">{ev.player}</span>}
                </div>
                </React.Fragment>
              ))}
              {firstHalfDividerAt === liveDetail.events.length && (
                <div className="text-center text-brand-yellow text-xs font-bold py-2">{t('Fundi i pjesës së parë')}</div>
              )}
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
                    {tn(market.name)}
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
                            <span className={`text-xs ${isSelected ? 'text-brand-headerDark' : 'text-brand-text'}`}><OptionName match={match} name={opt.name} tn={tn} /></span>
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