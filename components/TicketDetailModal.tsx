import React, { useEffect, useState } from 'react';
import MatchupLabel from './MatchupLabel';
import LegWhen from './LegWhen';
import { useI18n } from '../i18n';
import { fetchMatchLiveDetail, fetchMatchById, MatchEvent } from '../services/api';
import { isHalftime } from '../utils/liveStatus';
import { MatchStatus } from '../types';
import MatchTimeline, { TimelineState } from './MatchTimeline';

// One ticket in a shape every screen can fill: the user's own bets, the admin's table, the agent's lists.
export interface TicketView {
  id: string;
  createdAt: number;
  status: string;
  type?: string;
  stake: number;
  totalOdds: number;
  potentialReturn: number;
  currency?: 'ALL' | 'EUR';
  user?: string;
  legs: { matchStartTime?: string; matchId?: string; matchHome: string; matchAway: string; marketName: string; selectionName: string; odds: number; status: string; placedState?: { minute: number | null; h: number | null; a: number | null } }[];
}

const legStyle = (s: string) => (s === 'WON' || s === 'HALF_WON' ? 'text-brand-accent' : s === 'LOST' || s === 'HALF_LOST' ? 'text-red-400' : s === 'VOID' ? 'text-gray-400' : 'text-brand-yellow');


// Tap-to-open timeline under each leg of a ticket. While the ticket is still open (PENDING) it
// refreshes by itself every few seconds; the match status decides the half / full-time markers.
const LegTimeline: React.FC<{ matchId: string; home: string; away: string; live: boolean }> = ({ matchId, home, away, live }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<MatchEvent[] | null>(null);
  const [state, setState] = useState<TimelineState>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    const load = async () => {
      try {
        const [d, m] = await Promise.all([fetchMatchLiveDetail(matchId), fetchMatchById(matchId).catch(() => null)]);
        if (stop) return;
        setEvents(d.events || []);
        setState({
          halftime: m ? isHalftime(m) : false,
          finished: m ? m.status === MatchStatus.FINISHED : false,
          liveStatus: m?.liveStatus,
          minuteNow: Number(d.statistics?.minute ?? String(m?.currentMinute ?? '').match(/^\d+/)?.[0] ?? NaN),
          homeScore: m?.liveHomeScore ?? d.statistics?.home_score ?? null,
          awayScore: m?.liveAwayScore ?? d.statistics?.away_score ?? null,
        });
        setFailed(false);
      } catch { if (!stop) setFailed(true); }
    };
    load();
    const timer = live ? window.setInterval(load, 8000) : undefined;
    return () => { stop = true; if (timer) window.clearInterval(timer); };
  }, [open, matchId, live]);

  return (
    <div className="mt-2">
      <button onClick={() => setOpen((v) => !v)} className="text-[11px] font-bold text-brand-accent flex items-center gap-1">
        <span>{open ? '▲' : '▼'}</span> {t('Kronologjia e ndeshjes')}
      </button>
      {open && (
        <div className="mt-2 rounded bg-[#282828] p-2">
          {events == null && !failed ? (
            <div className="text-center text-brand-textMuted text-xs py-3">{t('Duke ngarkuar ngjarjet...')}</div>
          ) : events == null ? (
            <div className="text-center text-red-400 text-xs py-3">{t("S'u ngarkuan ngjarjet")}</div>
          ) : (
            <MatchTimeline events={events} home={home} away={away} state={state} />
          )}
        </div>
      )}
    </div>
  );
};

const TicketDetailModal: React.FC<{ ticket: TicketView | null; onClose: () => void; actions?: React.ReactNode }> = ({ ticket, onClose, actions }) => {
  const { t, locale } = useI18n();
  useEffect(() => {
    if (!ticket) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ticket, onClose]);
  if (!ticket) return null;

  const label = (s: string) => (s === 'PENDING' ? t('Hapur') : s === 'WON' ? t('Fituar') : s === 'HALF_WON' ? t('Gjysmë fitore') : s === 'HALF_LOST' ? t('Gjysmë humbje') : s === 'VOID' ? t('Rimbursuar') : s === 'CANCELLED' ? t('ANULUAR') : t('Humbur'));
  const partialLoss = ticket.status === 'WON' && Number(ticket.potentialReturn) < Number(ticket.stake);
  const when = new Date(ticket.createdAt).toLocaleString(locale, { timeZone: 'Europe/Tirane', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const sym = ticket.currency === 'EUR' ? '€' : 'L';
  const kind = ticket.legs.length > 1 ? t('{n}-Fish', { n: ticket.legs.length }) : t('Bast i Thjeshtë');
  const returnLabel = ticket.status === 'PENDING' ? t('Fitimi i Mundshëm') : ticket.status === 'LOST' ? t('Humbur') : ticket.status === 'VOID' ? t('Rimbursuar') : ticket.status === 'CANCELLED' ? t('ANULUAR') : t('Paguar');

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-3" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-brand-panel border border-brand-divider rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-brand-divider">
          <div className="min-w-0">
            <div className="font-bold text-white">{kind} <span className="text-brand-textMuted font-normal text-xs">#{ticket.id.slice(-8)}</span></div>
            <div className="text-xs text-brand-textMuted tabular-nums">{when}{ticket.user ? ` · ${ticket.user}` : ''}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded bg-black/30 ${legStyle(ticket.status)}`}>{partialLoss ? t('Humbje e pjesshme') : label(ticket.status)}</span>
            <button onClick={onClose} aria-label={t('Mbyll')} className="text-brand-textMuted hover:text-white text-lg leading-none">✕</button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-2 flex-1 min-h-[9rem]">
          {ticket.legs.map((leg, i) => (
            <div key={i} className="bg-brand-bg rounded p-2.5 text-sm flex gap-2.5">
              <div className="w-5 flex-shrink-0 text-brand-yellow font-bold text-xs pt-0.5">{i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-brand-textMuted flex flex-wrap items-center gap-x-2 gap-y-0.5"><MatchupLabel home={leg.matchHome} away={leg.matchAway} size="xs" /><LegWhen placedState={leg.placedState} matchStartTime={leg.matchStartTime} className="text-[11px]" /></div>
                <div className="text-xs text-brand-textMuted truncate">{leg.marketName}</div>
                <div className="font-bold text-white">{leg.selectionName} <span className="text-brand-yellow font-normal tabular-nums">@{Number(leg.odds).toFixed(2)}</span></div>
                {leg.matchId && <LegTimeline matchId={leg.matchId} home={leg.matchHome} away={leg.matchAway} live={ticket.status === 'PENDING'} />}
              </div>
              <div className={`text-[11px] font-bold flex-shrink-0 ${legStyle(leg.status)}`}>{label(leg.status)}</div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-dashed border-brand-divider text-sm space-y-1 tabular-nums">
          <div className="flex justify-between"><span className="text-brand-textMuted">{t('Kuota totale')}</span><span className="text-brand-yellow font-bold">@{Number(ticket.totalOdds).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-brand-textMuted">Stake</span><span className="text-white font-bold">{Number(ticket.stake).toFixed(2)} {sym}</span></div>
          <div className="flex justify-between"><span className="text-brand-textMuted">{returnLabel}</span><span className="text-white font-bold">{Number(ticket.potentialReturn).toFixed(2)} {sym}</span></div>
        </div>
        {actions ? <div className="p-4 pt-2 flex flex-wrap gap-2 max-h-[40vh] overflow-y-auto flex-shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
};

export default TicketDetailModal;
