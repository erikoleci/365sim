import React, { useEffect, useState } from 'react';
import MatchupLabel from './MatchupLabel';
import { useI18n } from '../i18n';
import * as api from '../services/api';

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
  legs: { id?: number; matchHome: string; matchAway: string; marketName: string; selectionName: string; odds: number; status: string }[];
}

const legStyle = (s: string) => (s === 'WON' || s === 'HALF_WON' ? 'text-brand-accent' : s === 'LOST' || s === 'HALF_LOST' ? 'text-red-400' : s === 'VOID' ? 'text-gray-400' : 'text-brand-yellow');

type Choice = 'KEEP' | 'WON' | 'LOST' | 'VOID';

const TicketDetailModal: React.FC<{
  ticket: TicketView | null;
  onClose: () => void;
  /** Super admin only: show the "re-settle this ticket" tool. */
  canResettle?: boolean;
  /** Called after a ticket was re-settled, so the lists reload. */
  onResettled?: () => void;
}> = ({ ticket, onClose, canResettle, onResettled }) => {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<Record<number, Choice>>({});
  const [preview, setPreview] = useState<api.ResettleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setEditing(false); setChoice({}); setPreview(null); setError(''); }, [ticket?.id]);
  useEffect(() => {
    if (!ticket) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ticket, onClose]);
  if (!ticket) return null;

  const label = (s: string) => (s === 'PENDING' ? t('Hapur') : s === 'WON' ? t('Fituar') : s === 'HALF_WON' ? t('Gjysmë fitore') : s === 'HALF_LOST' ? t('Gjysmë humbje') : s === 'VOID' ? t('Rimbursuar') : t('Humbur'));
  const partialLoss = ticket.status === 'WON' && Number(ticket.potentialReturn) < Number(ticket.stake);
  const when = new Date(ticket.createdAt).toLocaleString(locale, { timeZone: 'Europe/Tirane', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const kind = ticket.legs.length > 1 ? t('{n}-Fish', { n: ticket.legs.length }) : t('Bast i Thjeshtë');
  const returnLabel = ticket.status === 'PENDING' ? t('Fitimi i Mundshëm') : ticket.status === 'LOST' ? t('Humbur') : ticket.status === 'VOID' ? t('Rimbursuar') : t('Paguar');

  const resettleLegs = () => ticket.legs
    .filter((l) => l.id != null && (choice[l.id as number] ?? 'KEEP') !== 'KEEP')
    .map((l) => ({ id: l.id as number, outcome: choice[l.id as number] as 'WON' | 'LOST' | 'VOID' }));
  const canEdit = !!canResettle && ticket.legs.length > 0 && ticket.legs.every((l) => l.id != null);
  const runResettle = async (dryRun: boolean) => {
    const legs = resettleLegs();
    if (legs.length === 0) { setError(t('Zgjidh rezultatin e të paktën një legu')); return; }
    setBusy(true); setError('');
    try {
      const r = await api.adminResettleBet(ticket.id, legs, dryRun);
      if (dryRun) { setPreview(r); return; }
      onResettled?.();
      onClose();
    } catch (e: any) {
      setPreview(null);
      setError(e?.message || t('Dështoi'));
    } finally {
      setBusy(false);
    }
  };
  const optionBtn = (legId: number, value: Choice, text: string, active: string) => (
    <button key={value} type="button" disabled={busy}
      onClick={() => { setChoice((c) => ({ ...c, [legId]: value })); setPreview(null); }}
      className={`flex-1 min-h-[36px] rounded text-[11px] font-bold ${(choice[legId] ?? 'KEEP') === value ? active : 'bg-black/30 text-brand-textMuted'}`}>{text}</button>
  );
  const money = (n: number) => `${Number(n).toFixed(2)} L`;

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

          {canEdit && (
            <div className="pt-2">
              {!editing ? (
                <button type="button" onClick={() => setEditing(true)} className="w-full min-h-[40px] rounded border border-brand-divider text-xs font-bold text-brand-textMuted hover:text-white">
                  {t('Rishlyej biletën (super admin)')}
                </button>
              ) : (
                <div className="border border-brand-yellow/40 rounded p-3 space-y-3">
                  <div className="text-xs text-brand-textMuted">
                    {t('Zgjidh rezultatin e vërtetë të legëve që duhen ndryshuar. Balanca e përdoruesit korrigjohet me diferencën (p.sh. rimbursimi hiqet nëse bileta del e humbur).')}
                  </div>
                  {ticket.legs.map((leg, i) => (
                    <div key={leg.id} className="space-y-1">
                      <div className="text-xs text-white truncate">{i + 1}. {leg.marketName}: <b>{leg.selectionName}</b></div>
                      <div className="flex gap-1.5">
                        {optionBtn(leg.id as number, 'KEEP', t('Pa ndryshim'), 'bg-[#555] text-white')}
                        {optionBtn(leg.id as number, 'WON', t('Fitues'), 'bg-brand-accent text-black')}
                        {optionBtn(leg.id as number, 'LOST', t('Humbës'), 'bg-red-600 text-white')}
                        {optionBtn(leg.id as number, 'VOID', t('Rimburso'), 'bg-[#777] text-white')}
                      </div>
                    </div>
                  ))}
                  {preview && (
                    <div className="rounded bg-black/30 p-2 text-xs space-y-0.5 tabular-nums">
                      <div className="text-white font-bold">{label(preview.fromStatus)} → {label(preview.toStatus)}</div>
                      <div className="text-brand-textMuted">
                        {t('Balanca e')} {ticket.user || ''}: {money(preview.balanceBefore)} → <b className="text-white">{money(preview.balanceAfter)}</b>{' '}
                        ({preview.delta > 0 ? '+' : ''}{money(preview.delta)})
                      </div>
                    </div>
                  )}
                  {error && <div className="text-xs text-red-400">{error}</div>}
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => runResettle(true)} className="flex-1 min-h-[40px] rounded bg-[#555] text-white text-xs font-bold">{t('Shiko efektin')}</button>
                    <button type="button" disabled={busy || !preview} onClick={() => runResettle(false)} className="flex-1 min-h-[40px] rounded bg-brand-yellow text-black text-xs font-bold disabled:opacity-40">{t('Konfirmo ndryshimin')}</button>
                  </div>
                </div>
              )}
            </div>
          )}
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
