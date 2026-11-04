import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { fetchMatchById } from '../services/api';
import { formatLiveStatus } from '../utils/liveStatus';
import { Match, MatchStatus } from '../types';

// "When / how is it going" lines of one ticket leg.
//  1. status (changes while the ticket is open): LIVE + the current minute and score while the match is in play,
//     "Ka mbaruar 2-1" once it is over, otherwise the kick-off time (Fillon 21:00).
//  2. only for legs booked while the match was running: "Vendosur live 46' · 0-2".
// Give it a `matchId` and `watch` and it asks the server for the match itself (and refreshes every 15 s), so a
// ticket booked before kick-off shows the live minute as soon as the match starts. Without matchId (the ticket
// list) it falls back to the stored data and makes no requests.
type Placed = { minute: number | null; h: number | null; a: number | null } | null | undefined;

export const LegWhen: React.FC<{ placedState?: Placed; matchStartTime?: string | null; matchId?: string; watch?: boolean; className?: string }> = ({ placedState, matchStartTime, matchId, watch, className = '' }) => {
  const { t, locale } = useI18n();
  const [match, setMatch] = useState<Match | null>(null);

  useEffect(() => {
    if (!matchId || !watch) return;
    let stop = false;
    const load = () => fetchMatchById(matchId).then((m) => { if (!stop) setMatch(m); }).catch(() => {});
    load();
    const timer = window.setInterval(load, 15000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [matchId, watch]);

  const zone = { timeZone: 'Europe/Tirane' } as const;
  const hasScore = match && match.liveHomeScore != null && match.liveAwayScore != null;
  const score = hasScore ? `${match!.liveHomeScore}-${match!.liveAwayScore}` : '';

  let status: React.ReactNode = null;
  if (match && match.status === MatchStatus.LIVE) {
    status = (
      <span className="inline-flex items-center gap-1 tabular-nums">
        <span className="bg-red-600 text-white font-bold text-[9px] leading-none px-1 py-0.5 rounded">LIVE</span>
        <span className="text-white">{formatLiveStatus(match)}{score ? ` · ${score}` : ''}</span>
      </span>
    );
  } else if (match && match.status === MatchStatus.FINISHED) {
    const fin = match.score ? `${match.score.home}-${match.score.away}` : score;
    status = <span className="tabular-nums text-brand-textMuted">{t('Ka Mbaruar')}{fin ? ` ${fin}` : ''}</span>;
  } else {
    const ms = (match?.startTime || matchStartTime) ? new Date((match?.startTime || matchStartTime) as string).getTime() : NaN;
    if (Number.isFinite(ms)) {
      const d = new Date(ms);
      const time = d.toLocaleTimeString(locale, { ...zone, hour: '2-digit', minute: '2-digit', hour12: false });
      const sameDay = d.toLocaleDateString(locale, zone) === new Date().toLocaleDateString(locale, zone);
      status = <span className="tabular-nums text-brand-textMuted">{t('Fillon')} {sameDay ? time : `${d.toLocaleDateString(locale, { ...zone, day: '2-digit', month: '2-digit' })} ${time}`}</span>;
    }
  }

  const placed = placedState && placedState.h != null && placedState.a != null ? (
    <span className="tabular-nums text-brand-textMuted">
      {t('Vendosur live')} {placedState.minute != null ? `${placedState.minute}' · ` : ''}{placedState.h}-{placedState.a}
    </span>
  ) : null;

  if (!status && !placed) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 ${className}`}>
      {status}{placed}
    </span>
  );
};

export default LegWhen;
