import React, { useMemo } from 'react';
import { useI18n } from '../i18n';
import type { MatchEvent } from '../services/api';
import { eventMinuteLabel, firstHalfDividerIndex, regularTimeDividerIndex } from '../utils/eventHalf';

// One timeline for the match page AND the ticket: home events on the left, away events on the
// right, the minute on a vertical line in the middle, newest on top. Corners, cards and goals
// are numbered in order (Korneri 1, 2, 3 ...). Markers show the score at the end of the first
// half, at the start of the second half, and the final score once the match is over.

export interface TimelineState {
  halftime?: boolean;
  finished?: boolean;
  liveStatus?: string | null;
  minuteNow?: number;
  homeScore?: number | null;
  awayScore?: number | null;
}

// match_events.team is the team NAME for goals but 'home' / 'away' for cards and corners.
const sideOf = (team: string | null | undefined, home: string, away: string): 'home' | 'away' | null => {
  if (!team) return null;
  if (team === 'home' || team === home) return 'home';
  if (team === 'away' || team === away) return 'away';
  return null;
};


// Small flat icons, same idea as the provider's own timeline: a card is a coloured rectangle, a goal a ball,
// a corner a flag. Plain SVG/CSS so they look the same on every phone.
const EventIcon: React.FC<{ kind: string }> = ({ kind }) => {
  switch (kind) {
    case 'YELLOW_CARD': return <span className="inline-block w-3 h-4 rounded-[2px] bg-yellow-500 flex-shrink-0" />;
    case 'RED_CARD': return <span className="inline-block w-3 h-4 rounded-[2px] bg-red-600 flex-shrink-0" />;
    case 'GOAL': return (
      <svg width="16" height="16" viewBox="0 0 16 16" className="flex-shrink-0"><circle cx="8" cy="8" r="7" fill="#e5e7eb" /><path d="M8 4.2l2.6 1.9-1 3H6.4l-1-3z" fill="#374151" /></svg>
    );
    case 'CORNER': return (
      <svg width="16" height="16" viewBox="0 0 16 16" className="flex-shrink-0"><path d="M3 1.5v13" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" /><path d="M3.8 2.2h8l-2.2 3 2.2 3h-8z" fill="#f87171" /></svg>
    );
    case 'SUBSTITUTION': return <span className="text-emerald-400 text-sm flex-shrink-0">⇄</span>;
    case 'VAR': return <span className="text-[9px] font-bold border border-white/60 rounded px-0.5 flex-shrink-0">VAR</span>;
    default: return null;
  }
};

type Row =
  | { kind: 'event'; key: string; minute: string; text: string; kind2: string; player?: string; out?: string; side: 'home' | 'away' | null }
  | { kind: 'marker'; key: string; text: string; strong?: boolean };

const MatchTimeline: React.FC<{ events: MatchEvent[]; home: string; away: string; state?: TimelineState }> = ({ events, home, away, state }) => {
  const { t } = useI18n();
  const st = state || {};

  const rows = useMemo<Row[]>(() => {
    const list = events || [];
    const counts: Record<string, number> = {};
    const goalsBefore = (end: number) => {
      let h = 0, a = 0;
      list.slice(0, end).forEach((e) => {
        if (e.type !== 'GOAL') return;
        const s = sideOf(e.team, home, away);
        if (s === 'home') h++; else if (s === 'away') a++;
      });
      return `${h}-${a}`;
    };
    const ht = firstHalfDividerIndex(list, { halftime: !!st.halftime, finished: !!st.finished, minuteNow: st.minuteNow ?? NaN, liveStatus: st.liveStatus });
    const rt = regularTimeDividerIndex(list);

    const asc: Row[] = [{ kind: 'event', key: 'kickoff', minute: "1'", text: t('Fillimi i ndeshjes'), kind2: 'KICKOFF', side: null }];
    const pushHalfMarkers = () => {
      const sc = goalsBefore(ht as number);
      asc.push({ kind: 'marker', key: 'ht', text: `${t('Rezultati në fund të pjesës së parë')} ${sc}`, strong: true });
      if (!(st.halftime && ht === list.length)) {
        asc.push({ kind: 'marker', key: 'h2', text: `${t('Rezultati në fillim të pjesës së dytë')} ${sc}`, strong: true });
      }
    };
    list.forEach((ev, i) => {
      if (i === ht) pushHalfMarkers();
      if (i === rt) asc.push({ kind: 'marker', key: 'rt', text: t('Fundi i kohës rregullt'), strong: true });
      let text: string | null = null;
      if (['CORNER', 'YELLOW_CARD', 'RED_CARD', 'GOAL'].includes(ev.type)) {
        counts[ev.type] = (counts[ev.type] || 0) + 1;
        const n = counts[ev.type];
        text = `${ev.type === 'CORNER' ? t('Korneri') : ev.type === 'YELLOW_CARD' ? t('Karton i verdhë') : ev.type === 'RED_CARD' ? t('Karton i kuq') : t('Goli')} ${n}`;
      } else if (ev.type === 'SUBSTITUTION') text = t('Ndërrim');
      else if (ev.type === 'VAR') text = 'VAR';
      if (text) asc.push({ kind: 'event', key: `e${i}`, minute: eventMinuteLabel(ev), text, kind2: ev.type, player: ev.player || undefined, out: ev.type === 'SUBSTITUTION' && ev.detail ? ev.detail : undefined, side: sideOf(ev.team, home, away) });
    });
    if (ht === list.length && ht != null) pushHalfMarkers();
    if (st.halftime && ht == null) asc.push({ kind: 'marker', key: 'ht-now', text: t('Pushim'), strong: true });
    if (st.finished) {
      const sc = st.homeScore != null && st.awayScore != null ? ` ${st.homeScore}-${st.awayScore}` : '';
      asc.push({ kind: 'marker', key: 'ft', text: `${t('Fundi i ndeshjes')}${sc}`, strong: true });
    }
    return asc.reverse();
  }, [events, home, away, st.halftime, st.finished, st.liveStatus, st.minuteNow, st.homeScore, st.awayScore, t]);

  return (
    <div className="text-[13px]">
      {rows.map((r) => r.kind === 'marker' ? (
        <div key={r.key} className="text-center text-brand-yellow font-bold text-sm py-3">{r.text}</div>
      ) : (
        <div key={r.key} className="grid grid-cols-[1fr_auto_1fr] items-stretch">
          <div className="flex items-center justify-end gap-2 pr-2 py-1.5 text-white text-right">
            {r.side === 'home' && <><span className="leading-tight">{r.text}</span><EventIcon kind={r.kind2} /></>}
          </div>
          <div className="relative flex flex-col items-center justify-center px-3 py-2 min-w-[4.5rem] max-w-[8rem]">
            {r.side && <span className={`absolute top-1 bottom-1 w-1 rounded bg-emerald-700 ${r.side === 'home' ? 'left-0' : 'right-0'}`} />}
            <span className="font-bold text-white text-[15px] tabular-nums leading-none">{r.minute}</span>
            {r.player && <span className="mt-1 text-center font-bold text-white/90 text-[12px] leading-snug break-words">{r.out ? <span className="text-emerald-400">↑ {r.player}</span> : r.player}</span>}
            {r.out && <span className="text-center text-red-400 text-[12px] leading-snug break-words">↓ {r.out}</span>}
          </div>
          <div className="flex items-center justify-start gap-2 pl-2 py-1.5 text-white">
            {r.side !== 'home' && <>{r.side === 'away' && <EventIcon kind={r.kind2} />}<span className="leading-tight">{r.text}</span></>}
          </div>
        </div>
      ))}
    </div>
  );
};

export default MatchTimeline;
