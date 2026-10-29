import React, { useEffect } from 'react';
import MatchupLabel from './MatchupLabel';
import { useI18n } from '../i18n';

// One ticket in a shape every screen can fill: the user's own bets, the admin's table, the agent's lists.
export interface TicketView {
  id: string;
  createdAt: number;
  status: string;
  type?: string;
  stake: number;
  totalOdds: number;
  potentialReturn: number;
  user?: string;
  legs: { matchHome: string; matchAway: string; marketName: string; selectionName: string; odds: number; status: string }[];
}

const legStyle = (s: string) => (s === 'WON' || s === 'HALF_WON' ? 'text-brand-accent' : s === 'LOST' || s === 'HALF_LOST' ? 'text-red-400' : s === 'VOID' ? 'text-gray-400' : 'text-brand-yellow');

const TicketDetailModal: React.FC<{ ticket: TicketView | null; onClose: () => void }> = ({ ticket, onClose }) => {
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

        <div className="p-4 overflow-y-auto space-y-2">
          {ticket.legs.map((leg, i) => (
            <div key={i} className="bg-brand-bg rounded p-2.5 text-sm flex gap-2.5">
              <div className="w-5 flex-shrink-0 text-brand-yellow font-bold text-xs pt-0.5">{i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-brand-textMuted"><MatchupLabel home={leg.matchHome} away={leg.matchAway} size="xs" /></div>
                <div className="text-xs text-brand-textMuted truncate">{leg.marketName}</div>
                <div className="font-bold text-white">{leg.selectionName} <span className="text-brand-yellow font-normal tabular-nums">@{Number(leg.odds).toFixed(2)}</span></div>
              </div>
              <div className={`text-[11px] font-bold flex-shrink-0 ${legStyle(leg.status)}`}>{label(leg.status)}</div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-dashed border-brand-divider text-sm space-y-1 tabular-nums">
          <div className="flex justify-between"><span className="text-brand-textMuted">{t('Kuota totale')}</span><span className="text-brand-yellow font-bold">@{Number(ticket.totalOdds).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-brand-textMuted">Stake</span><span className="text-white font-bold">{Number(ticket.stake).toFixed(2)} L</span></div>
          <div className="flex justify-between"><span className="text-brand-textMuted">{returnLabel}</span><span className="text-white font-bold">{Number(ticket.potentialReturn).toFixed(2)} L</span></div>
        </div>
      </div>
    </div>
  );
};

export default TicketDetailModal;
