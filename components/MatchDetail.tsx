import React, { useState, useMemo, useEffect } from 'react';
import { Match, MatchStatus } from '../types';
import * as api from '../services/api';
import type { LiveStatistics, MatchEvent, MatchExtra } from '../services/api';
import StadiumPitch from './StadiumPitch';
import StatRings from './StatRings';
import { useTickingClock, formatLiveClock } from './MatchCard';
import { isHalftime, liveMinuteFallback, formatScore, pickClockSource, isLiveClockStale } from '../utils/liveStatus';
import { useI18n } from '../i18n';
import TeamLogo from './TeamLogo';
import MatchTimeline from './MatchTimeline';
import MomentumChart, { AttackSample } from './MomentumChart';
import EventBanner, { BannerInfo } from './EventBanner';
import { groupMarkets } from '../utils/marketTables';
import type { MarketOption } from '../types';

interface MatchDetailProps {
  match: Match;
  leagueLabel: string;
  onClose: () => void;
  onBetClick: (match: Match, marketId: string, selectionId: string) => void;
  selectedIds: string[];
  // Opened from a ticket: live/finished matches show only statistics and events (no betting tabs).
  readOnly?: boolean;
}

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

const STAT_FIELDS = ['possession_home', 'shots_home', 'shots_on_target_home', 'corners_home', 'cards_home', 'xg_home', 'attacks_home', 'dangerous_attacks_home', 'attacks_away', 'dangerous_attacks_away', 'possession_away', 'shots_away', 'shots_on_target_away', 'corners_away', 'cards_away', 'xg_away'];

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

const MatchDetail: React.FC<MatchDetailProps> = ({ match, leagueLabel, onClose, onBetClick, selectedIds, readOnly }) => {
  const { t, tn } = useI18n();
  const isFinished = match.status === MatchStatus.FINISHED;
  const isLive = match.status === MatchStatus.LIVE;
  const hasLiveData = isLive || isFinished;
  // Same per-second ticking clock as the match list/pitch view — shown right
  // in the header (next to the score) so it's visible the moment the page
  // opens, instead of only inside the pitch box further down, and so it
  // never looks frozen on whatever minute it happened to load at (e.g. "93'"
  // sitting still) between the 15s poll/socket refreshes.
  const [activeTab, setActiveTab] = useState<string>(readOnly && (match.status === MatchStatus.LIVE || match.status === MatchStatus.FINISHED) ? 'EVENTS' : 'All');
  const [liveDetail, setLiveDetail] = useState<{ statistics: LiveStatistics | null; events: MatchEvent[]; extra?: MatchExtra | null } | null>(null);
  // Statistics the main feed does not have (passes, tackles, fouls, saves...): printed as Flashscore gives them, text on both sides.
  const extraStatsList = liveDetail?.extra?.stats?.length ? (
    <div className="mt-4 space-y-2">
      {liveDetail.extra.stats.map((s) => (
        <div key={s.name} className="flex items-center justify-between text-xs border-b border-white/5 pb-1.5">
          <span className="text-white font-bold tabular-nums w-1/3">{s.home}</span>
          <span className="text-brand-textMuted text-center flex-1 uppercase">{s.name}</span>
          <span className="text-white font-bold tabular-nums w-1/3 text-right">{s.away}</span>
        </div>
      ))}
    </div>
  ) : null;
  const [liveDetailLoading, setLiveDetailLoading] = useState(false);
  const [banner, setBanner] = useState<BannerInfo | null>(null);
  const [attackSamples, setAttackSamples] = useState<AttackSample[]>([]);
  const [cardFlash, setCardFlash] = useState<{ kind: 'YELLOW_CARD' | 'RED_CARD'; team: 'home' | 'away' } | null>(null);
  // The provider rarely sends statistics (possession, shots, corners, xG...). When none arrived
  // the "Statistika" tab would only ever say "not available", so the tab is not shown at all.
  const hasAnyStat = !!liveDetail?.statistics && STAT_FIELDS.some((k) => (liveDetail.statistics as any)[k] != null);
  useEffect(() => {
    if (activeTab === 'STATS' && !liveDetailLoading && !hasAnyStat) setActiveTab(hasLiveData ? 'EVENTS' : 'All');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, liveDetailLoading, hasAnyStat]);
  // Momentum: remember the attack counters at every refresh while the page is open (see MomentumChart).
  useEffect(() => {
    const st = liveDetail?.statistics as any;
    if (!st || st.attacks_home == null || st.attacks_away == null) return;
    const cur: AttackSample = { at: Date.now(), ha: Number(st.attacks_home), hd: Number(st.dangerous_attacks_home ?? 0), aa: Number(st.attacks_away), ad: Number(st.dangerous_attacks_away ?? 0) };
    setAttackSamples((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.ha === cur.ha && last.hd === cur.hd && last.aa === cur.aa && last.ad === cur.ad && cur.at - last.at < 60000) return prev;
      return [...prev, cur].slice(-60);
    });
  }, [liveDetail]);
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
    // A request that hangs (slow database, server busy) must not leave "Duke ngarkuar ngjarjet..." on screen for ever:
    // after 8 s it counts as failed, the list shows what it has, and the load is tried again a few seconds later.
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const load = (initial = false) => {
      if (initial) setLiveDetailLoading(true);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('live-detail timeout')), 8000); });
      Promise.race([api.fetchMatchLiveDetail(match.liveSourceId ?? match.id), timeout])
        .then((d) => { failures = 0; if (!cancelled) setLiveDetail(d); })
        .catch(() => {
          if (cancelled) return;
          setLiveDetail((prev) => prev ?? { statistics: null, events: [] });
          if (failures < 4) { failures += 1; if (retryTimer) clearTimeout(retryTimer); retryTimer = setTimeout(() => load(), 3000); }
        })
        .finally(() => { clearTimeout(timer); if (!cancelled && initial) setLiveDetailLoading(false); });
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
    let bannerTimer: ReturnType<typeof setTimeout> | null = null;
    const showBanner = (b: Omit<BannerInfo, 'id'>) => {
      setBanner({ ...b, id: Date.now() });
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => setBanner(null), 3000);
    };
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
          const mm = msg.minute != null && msg.minute !== '' ? String(msg.minute).replace(/'?$/, "'") : undefined;
          const sc = msg.homeScore != null && msg.awayScore != null ? `${msg.homeScore} - ${msg.awayScore}` : undefined;
          if (msg.type === 'GOAL') showBanner({ kind: 'GOAL', team: String(msg.scoringTeam || ''), score: sc, minute: mm });
          else if (msg.type === 'GOAL_DISALLOWED') showBanner({ kind: 'GOAL_DISALLOWED', team: String(msg.team || ''), score: sc, minute: mm });
          else if (msg.type === 'CARD' && (msg.cardType === 'YELLOW_CARD' || msg.cardType === 'RED_CARD')) showBanner({ kind: msg.cardType, team: msg.team === 'home' ? match.homeTeam : msg.team === 'away' ? match.awayTeam : String(msg.team || ''), minute: mm });
          if (msg.type === 'GOAL' || msg.type === 'GOAL_DISALLOWED' || msg.type === 'CARD' || msg.type === 'MATCH_ENDED') load();
        } catch { /* ignore malformed message */ }
      };
    }

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      if (flashTimer) clearTimeout(flashTimer);
      if (bannerTimer) clearTimeout(bannerTimer);
      socket?.close();
    };
  }, [match.id, hasLiveData, match.status]);

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
  const filteredMarkets = useMemo(
    () => match.markets
      .filter(m => activeTab === 'All' || m.category === activeTab)
      .map(m => ({ ...m, options: m.options.filter(o => !o.suspended && o.odds > 0) }))
      .filter(m => m.options.length > 0),
    [match.markets, activeTab]
  );

  // Goals / corners / cards over-under lines, "Gara e Korneve" and the asian handicap come as ONE table
  // each (a row per line) instead of one box per line -- see utils/marketTables.ts.
  const blocks = useMemo(() => groupMarkets(filteredMarkets, match.homeTeam, match.awayTeam), [filteredMarkets, match.homeTeam, match.awayTeam]);

  const getButtonClass = (marketId: string, selectionId: string) => {
    const uniqueId = `${match.id}-${marketId}-${selectionId}`;
    const isSelected = selectedIds.includes(uniqueId);
    
    // Standard odds block style
    const base = "flex items-center justify-center gap-2 py-3 px-2 cursor-pointer transition-colors text-center";
    if (isFinished) return `${base} opacity-50 cursor-default bg-[#4a4a4a] text-brand-textMuted`;
    if (isSelected) return `${base} bg-brand-yellow text-brand-headerDark font-bold`;
    return `${base} bg-[#4a4a4a] hover:bg-[#565656] text-brand-text`;
  };

  // One clickable odds cell. `showName`: the option text in front of the price (plain boxes and the
  // extras under a table); table cells show the price alone, or `label` + price (asian handicap line).
  const renderOption = (marketId: string, opt: MarketOption, { showName = false, label }: { showName?: boolean; label?: string } = {}) => {
    const isSelected = selectedIds.includes(`${match.id}-${marketId}-${opt.id}`);
    const flash = oddsFlash.get(`${marketId}-${opt.id}`);
    return (
      <div
        key={`${marketId}-${opt.id}`}
        onClick={() => !isFinished && onBetClick(match, marketId, opt.id)}
        className={getButtonClass(marketId, opt.id)}
      >
        {showName && <span className={`text-xs ${isSelected ? 'text-brand-headerDark' : 'text-brand-text'}`}><OptionName match={match} name={opt.name} tn={tn} /></span>}
        {label && <span className={`text-xs ${isSelected ? 'text-brand-headerDark' : 'text-brand-text'}`}>{label}</span>}
        <span className={`font-bold text-sm flex items-center gap-0.5 ${isSelected ? 'text-brand-headerDark' : 'text-brand-yellow'}`}>
          {opt.odds.toFixed(2)}
          {flash === 'up' && <span className="text-[10px] text-green-400">▲</span>}
          {flash === 'down' && <span className="text-[10px] text-red-400">▼</span>}
        </span>
      </div>
    );
  };

  return (
    <div className="bg-brand-bg text-brand-text h-full flex flex-col">
      {/* Phone: a small floating back pill that stays visible while scrolling markets (the small "‹ Soccer" link
          below is hidden under the FUTBOLL menu button on narrow screens). It goes back through the browser
          history, same as the phone's own back button; the bet slip selections stay as they were. */}
      <EventBanner banner={banner} />
      <button
        onClick={onClose}
        aria-label={t('Kthehu')}
        className="md:hidden fixed bottom-4 left-3 z-40 flex items-center gap-1.5 h-10 pl-3 pr-3.5 rounded-full text-xs font-bold text-white bg-black/75 backdrop-blur-md border border-white/20 shadow-[0_6px_18px_rgba(0,0,0,0.55)] active:scale-95 transition-transform"
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-brand-yellow" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4l-6 6 6 6" /></svg>
        {t('Kthehu')}
      </button>
      {/* Match Header: compact. League + clock on one line, the score on ONE row (small crest + name each side), then the pitch.
          The old header stacked a big league label, a clock pill, a huge crest + 2xl name per team and a 3xl score above
          the pitch, which left little room for the markets on a phone. */}
      <div className="bg-[radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1.2px)] [background-size:6px_6px] bg-brand-headerDark/30 px-2 py-2 sm:px-4 sm:py-3 relative border-b border-brand-divider">
        <button onClick={onClose} className="hidden md:flex absolute top-3 left-4 text-brand-textMuted hover:text-white text-xs font-bold items-center gap-1">
          ‹ Soccer
        </button>
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-1.5">
            <span className="text-[10px] sm:text-xs text-brand-textMuted uppercase tracking-wider truncate">{leagueLabel}</span>
            {isLive && (
              <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${isHalftime(match) ? 'bg-brand-yellow text-black' : 'bg-brand-accent/90 text-black'}`}>
                {isHalftime(match) ? t('Pushim') : headerClock ? formatLiveClock(headerClock) : liveMinuteFallback(match)}
                {isLiveClockStale(match) && <span title={t('Pa përditësim nga provider-i')} className="ml-1 text-amber-400">●</span>}
              </span>
            )}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 max-w-[640px] mx-auto">
            <div className="flex items-center justify-end gap-2 min-w-0">
              <div className="text-sm sm:text-lg font-bold text-white text-right leading-tight break-words min-w-0">{match.homeTeam}</div>
              <TeamLogo name={match.homeTeam} league={match.league} providerLogo={match.homeTeamLogo} size={28} />
            </div>
            <div className="text-xl sm:text-2xl text-brand-yellow font-mono font-bold whitespace-nowrap px-1">
              {isFinished
                ? (match.score && match.score.home != null && match.score.away != null
                    ? `${match.score.home} - ${match.score.away}`
                    // closed without a stored final score: the last live score if there was one, never "undefined - undefined"
                    : match.liveHomeScore != null && match.liveAwayScore != null
                      ? `${formatScore(match.liveHomeScore)} - ${formatScore(match.liveAwayScore)}`
                      : '– : –')
                : isLive
                  ? `${formatScore(match.liveHomeScore)} - ${formatScore(match.liveAwayScore)}`
                  : 'v'}
            </div>
            <div className="flex items-center justify-start gap-2 min-w-0">
              <TeamLogo name={match.awayTeam} league={match.league} providerLogo={match.awayTeamLogo} size={28} />
              <div className="text-sm sm:text-lg font-bold text-white text-left leading-tight break-words min-w-0">{match.awayTeam}</div>
            </div>
          </div>
          {isLive && (
            <div className="mt-2">
              <StadiumPitch match={match} stats={liveDetail?.statistics ?? null} flash={cardFlash} />
            </div>
          )}
          {isFinished && (
            <div className="mt-2 text-xs text-brand-accent">
              FT
              {match.score?.htHome != null && match.score?.htAway != null ? ` | HT: ${match.score.htHome}-${match.score.htAway}` : ''}
              {liveDetail?.statistics?.corners_home != null && liveDetail?.statistics?.corners_away != null && (liveDetail.statistics.corners_home + liveDetail.statistics.corners_away > 0)
                ? ` | Corners: ${liveDetail.statistics.corners_home}-${liveDetail.statistics.corners_away}` : ''}
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
            {!(readOnly && hasLiveData) && categories.map(cat => (
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

      {liveDetail?.extra && (liveDetail.extra.leg || liveDetail.extra.aggregate) && (
        <div className="px-4 py-1.5 bg-[#2f2f2f] text-center text-[11px] text-brand-yellow font-bold border-b border-white/5">
          {liveDetail.extra.leg === 1 ? t('Ndeshja e parë') : liveDetail.extra.leg === 2 ? t('Ndeshja e kthimit') : ''}
          {liveDetail.extra.leg && liveDetail.extra.aggregate ? ' · ' : ''}
          {liveDetail.extra.aggregate ? `${t('Gjithsej')} ${liveDetail.extra.aggregate}` : ''}
          {liveDetail.extra.leg === 2 && liveDetail.extra.firstLeg ? ` · ${t('Ndeshja e parë')} ${liveDetail.extra.firstLeg}` : ''}
        </div>
      )}
      {/* Stats / Events / Markets Content */}
      {activeTab === 'STATS' ? (
        <div className="p-4 overflow-y-auto flex-1 bg-[#282828]">
          {liveDetailLoading ? (
            <div className="text-center text-brand-textMuted text-xs py-8">{t('Duke ngarkuar statistikat...')}</div>
          
          ) : !liveDetail?.statistics || !STAT_FIELDS.some((k) => (liveDetail.statistics as any)[k] != null) ? (
            liveDetail?.extra && (liveDetail.extra.bigChancesHome != null || liveDetail.extra.bigChancesAway != null || liveDetail.extra.stats?.length) ? (
              <div>
                {(liveDetail.extra.bigChancesHome != null || liveDetail.extra.bigChancesAway != null) && <StatBar label={t('Raste të mëdha')} home={liveDetail.extra.bigChancesHome} away={liveDetail.extra.bigChancesAway} />}
                {extraStatsList}
              </div>
            ) : (
            <div className="text-center text-brand-textMuted text-xs py-8">
              {t("Statistika live s'janë të disponueshme për këtë ndeshje.")}
            </div>)
          ) : (
            <div>
              <StatRings stats={liveDetail.statistics} homeName={match.homeTeam} awayName={match.awayTeam} />
              {liveDetail.statistics.attacks_home != null && liveDetail.statistics.attacks_away != null && (
                <div className="mt-3"><MomentumChart samples={attackSamples} home={match.homeTeam} away={match.awayTeam} /></div>
              )}
              {(liveDetail.statistics.xg_home != null || liveDetail.statistics.xg_away != null) && (
                <div className="mt-4"><StatBar label="xG" home={liveDetail.statistics.xg_home} away={liveDetail.statistics.xg_away} /></div>
              )}
              {liveDetail.extra && (liveDetail.extra.bigChancesHome != null || liveDetail.extra.bigChancesAway != null) && (
                <div className="mt-4"><StatBar label={t('Raste të mëdha')} home={liveDetail.extra.bigChancesHome} away={liveDetail.extra.bigChancesAway} /></div>
              )}
              {extraStatsList}
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
            <MatchTimeline
              events={liveDetail.events}
              home={match.homeTeam}
              away={match.awayTeam}
              state={{
                halftime: isHalftime(match),
                finished: isFinished,
                liveStatus: match.liveStatus,
                minuteNow: Number(liveDetail?.statistics?.minute ?? String(match.currentMinute ?? '').match(/^\d+/)?.[0] ?? NaN),
                homeScore: match.liveHomeScore,
                awayScore: match.liveAwayScore,
              }}
            />
          )}
        </div>
      ) : (
      <div className="p-2 space-y-2 overflow-y-auto flex-1 bg-[#282828]">
        {blocks.map(block => {
            if (block.type === 'table') {
                const { section } = block;
                const cols = section.headers.length;
                const gridCols = section.hasLabelColumn ? `3.5rem repeat(${cols}, minmax(0, 1fr))` : `repeat(${cols}, minmax(0, 1fr))`;
                return (
                <div key={section.key} className="overflow-hidden mb-2">
                    <div className="bg-brand-header px-3 py-2 text-xs font-bold text-white">
                        {tn(section.title)}
                    </div>
                    <div className="grid bg-[#3a3a3a] text-brand-textMuted text-[11px] font-bold text-center" style={{ gridTemplateColumns: gridCols }}>
                        {section.hasLabelColumn && <div className="py-1.5" />}
                        {section.headers.map((h, i) => <div key={i} className="py-1.5">{tn(h)}</div>)}
                    </div>
                    {section.rows.map((row, ri) => (
                        <div key={ri} className="grid gap-px bg-brand-bg mt-px" style={{ gridTemplateColumns: gridCols }}>
                            {section.hasLabelColumn && (
                                <div className="flex items-center justify-center bg-[#3f3f3f] text-xs font-bold text-brand-text">{row.label}</div>
                            )}
                            {row.cells.map((cell, ci) => cell
                                ? renderOption(cell.marketId, cell.option, { label: cell.label })
                                : <div key={ci} className="bg-[#3f3f3f]" />)}
                        </div>
                    ))}
                    {section.extras.length > 0 && (
                        <div className="grid gap-px bg-brand-bg mt-px" style={{ gridTemplateColumns: `repeat(${Math.min(section.extras.length, 3)}, minmax(0, 1fr))` }}>
                            {section.extras.map(cell => renderOption(cell.marketId, cell.option, { showName: true }))}
                        </div>
                    )}
                </div>
                );
            }
            const market = block.market;
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
                    {market.options.map(opt => renderOption(market.id, opt, { showName: true }))}
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