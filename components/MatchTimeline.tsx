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

type Row =
  | { kind: 'event'; key: string; minute: string; label: string; side: 'home' | 'away' | null }
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

    const asc: Row[] = [{ kind: 'event', key: 'kickoff', minute: "1'", label: t('Fillimi i ndeshjes'), side: null }];
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
      let label: string | null = null;
      if (['CORNER', 'YELLOW_CARD', 'RED_CARD', 'GOAL'].includes(ev.type)) {
        counts[ev.type] = (counts[ev.type] || 0) + 1;
        const n = counts[ev.type];
        label = ev.type === 'CORNER' ? `🚩 ${t('Korneri')} ${n}`
          : ev.type === 'YELLOW_CARD' ? `🟨 ${t('Karton i verdhë')} ${n}`
          : ev.type === 'RED_CARD' ? `🟥 ${t('Karton i kuq')} ${n}`
          : `⚽ ${t('Goli')} ${n}${ev.player ? ` · ${ev.player}` : ''}`;
      } else if (ev.type === 'SUBSTITUTION') label = `🔄 ${t('Ndërrim')}${ev.player ? ` · ${ev.player}` : ''}`;
      else if (ev.type === 'VAR') label = '📺 VAR';
      if (label) asc.push({ kind: 'event', key: `e${i}`, minute: eventMinuteLabel(ev), label, side: sideOf(ev.team, home, away) });
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
    <div className="text-xs">
      {rows.map((r) => r.kind === 'marker' ? (
        <div key={r.key} className="text-center text-brand-yellow font-bold py-1.5">{r.text}</div>
      ) : (
        <div key={r.key} className="grid grid-cols-[1fr_3.25rem_1fr] items-center min-h-[2rem]">
          <div className="text-right text-white pr-2">{r.side === 'home' ? r.label : ''}</div>
          <div className="relative text-center font-mono font-bold text-white py-1.5 before:content-[''] before:absolute before:left-1/2 before:-translate-x-1/2 before:inset-y-0 before:w-0.5 before:bg-brand-accent/70">
            <span className="relative bg-[#282828] px-1 rounded">{r.minute}</span>
          </div>
          <div className="text-left text-white pl-2">{r.side === 'home' ? '' : r.label}</div>
        </div>
      ))}
    </div>
  );
};

export default MatchTimeline;
