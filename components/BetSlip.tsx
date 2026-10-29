import React, { useState, useEffect, useMemo } from 'react';
import { BetSelectionItem, Bet, BetStatus } from '../types';
import { useI18n } from '../i18n';
import MatchupLabel from './MatchupLabel';
import TicketDetailModal, { TicketView } from './TicketDetailModal';
import { findSlipConflicts, legKey } from '../utils/betSlipRules';

interface BetSlipProps {
  selections: BetSelectionItem[];
  onRemoveSelection: (uniqueId: string) => void;
  onClearAll: () => void;
  onPlaceBet: (stake: number, type: 'SINGLE' | 'ACCUMULATOR') => void;
  onCancelBet: (betId: string, origin: 'USER' | 'ADMIN') => void;
  userBalance: number;
  myBets: Bet[];
}

const MIN_STAKE = 10; // must match MIN_STAKE in server/routes/bets.js
const MAX_STAKE = 1000000; // must match MAX_STAKE in server/routes/bets.js
const MAX_POTENTIAL_RETURN = 1000000; // must match MAX_POTENTIAL_RETURN in server/routes/bets.js

const BetSlip: React.FC<BetSlipProps> = ({ selections, onRemoveSelection, onClearAll, onPlaceBet, onCancelBet, userBalance, myBets }) => {
  const { t, locale } = useI18n();
  const [stake, setStake] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'slip' | 'mybets'>('slip');
  const [showConfirm, setShowConfirm] = useState(false);
  const [openTicket, setOpenTicket] = useState<TicketView | null>(null);
  
  // Force re-render to update timers for "Cancel" button visibility
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(n => n + 1), 30000); // Check every 30s
    return () => clearInterval(timer);
  }, []);

  // Auto switch to slip if selection made
  useEffect(() => {
    if (selections.length > 0) setActiveTab('slip');
  }, [selections.length]);

  const totalOdds = selections.reduce((acc, curr) => acc * curr.odds, 1);
  const isAccumulator = selections.length > 1;
  // Same Game Multiple: every selection in the slip belongs to the same
  // match — combine and label distinctly from a normal cross-match accumulator.
  const isSameGameMultiple = isAccumulator && new Set(selections.map((s) => s.matchId)).size === 1;
  const potentialReturn = (parseFloat(stake || '0') * totalOdds).toFixed(2);
  const stakeNum = parseFloat(stake || '0');
  const hasValidDecimals = Math.round(stakeNum * 100) / 100 === stakeNum;
  // Legs of the same match that follow the same logic (1+ / 2+ / 3+ / 4+ goals, "1-3 goals" with 2+,
  // 1 with 1X ...) cannot be combined: they are flagged and the ticket is blocked until one is removed.
  const conflicts = useMemo(() => findSlipConflicts(selections), [selections]);
  const hasConflicts = conflicts.size > 0;
  // A ticket whose possible payout is above MAX_POTENTIAL_RETURN is blocked here too
  // (the server refuses it as well, this just stops the player before the round trip).
  const exceedsMaxReturn = Number((stakeNum * totalOdds).toFixed(2)) > MAX_POTENTIAL_RETURN;
  const exceedsMaxStake = stakeNum > MAX_STAKE;
  const isValidStake = stakeNum >= MIN_STAKE && stakeNum <= MAX_STAKE && stakeNum <= userBalance && hasValidDecimals && !hasConflicts && !exceedsMaxReturn;
  const changedSelections = selections.filter((s) => typeof s.previousOdds === 'number');

  const handlePlaceBetClick = () => {
    if (!stake || !isValidStake || hasConflicts) return;
    setShowConfirm(true);
  };

  const confirmBet = () => {
    onPlaceBet(parseFloat(stake), isAccumulator ? 'ACCUMULATOR' : 'SINGLE');
    setStake('');
    setShowConfirm(false);
  };

  const cancelConfirm = () => {
      setShowConfirm(false);
  };

  return (
    <div className="bg-brand-panel h-full flex flex-col border-l border-brand-divider text-sm relative">

      {/* Confirmation Modal Overlay */}
      {showConfirm && (
          <div className="absolute inset-0 bg-black/90 z-20 flex flex-col items-center justify-center p-4 text-center transition-opacity duration-150">
              <h3 className="text-white font-bold text-lg mb-4 tracking-tight">{t('Konfirmo Biletën')}</h3>
              {/* Ticket receipt: dashed tear-line + punched notches, echoing a real betting slip stub */}
              <div className="relative bg-brand-bg border border-brand-divider rounded-lg w-full mb-4 overflow-hidden">
                  <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-black/90" />
                  <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-black/90" />
                  <div className="p-4">
                    <div className="flex justify-between mb-2 text-brand-textMuted text-xs">
                        <span>Stake</span>
                        <span className="text-white font-bold tabular-nums">{parseFloat(stake).toFixed(2)} L</span>
                    </div>
                    <div className="flex justify-between mb-3 text-brand-textMuted text-xs">
                        <span>{t('Kuota Totale')}</span>
                        <span className="text-brand-yellow font-bold tabular-nums">@{totalOdds.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-dashed border-brand-divider" />
                    <div className="flex justify-between pt-3">
                        <span className="text-brand-text">{t('Fitimi i Mundshëm')}</span>
                        <span className="text-brand-accent font-bold text-base tabular-nums">{potentialReturn} L</span>
                    </div>
                  </div>
              </div>
              <div className="flex gap-2 w-full">
                  <button onClick={cancelConfirm} className="flex-1 bg-transparent border border-brand-divider hover:border-white text-brand-text py-2.5 rounded-lg font-bold transition-colors">{t('Anulo')}</button>
                  <button onClick={confirmBet} className="flex-1 bg-brand-yellow hover:bg-yellow-400 text-brand-bg py-2.5 rounded-lg font-bold shadow-lg shadow-brand-yellow/10 transition-colors">{t('Vendos Biletën')}</button>
              </div>
          </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-brand-divider">
        <button
            className={`flex-1 py-3 font-bold text-center transition-colors relative ${activeTab === 'slip' ? 'bg-brand-header text-white' : 'text-brand-textMuted hover:bg-brand-bg'}`}
            onClick={() => setActiveTab('slip')}
        >
            {t('Bileta')} {selections.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] bg-brand-yellow text-brand-bg rounded-full text-[11px] font-extrabold">{selections.length}</span>}
        </button>
        <button
            className={`flex-1 py-3 font-bold text-center transition-colors ${activeTab === 'mybets' ? 'bg-brand-header text-white' : 'text-brand-textMuted hover:bg-brand-bg'}`}
            onClick={() => setActiveTab('mybets')}
        >
            {t('Biletat e Mia')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'slip' ? (
          <>
            {selections.length === 0 ? (
                <div className="flex flex-col items-center text-center mt-14 px-4">
                    <div className="w-12 h-12 rounded-full border-2 border-dashed border-brand-divider flex items-center justify-center text-brand-textMuted text-xl mb-3">
                        +
                    </div>
                    <p className="text-brand-text font-bold mb-1">{t('Bileta jote është bosh')}</p>
                    <p className="text-brand-textMuted text-xs leading-relaxed">{t('Zgjidh një kuotë nga tabela e ndeshjeve për ta shtuar këtu.')}</p>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex justify-end">
                         <button onClick={onClearAll} className="text-[11px] text-brand-textMuted hover:text-white transition-colors">{t('Hiq të Gjitha')}</button>
                    </div>

                    {/* Odds-changed notice — appears the moment a placeBet attempt
                        comes back with updated prices already merged into
                        `selections` (see previousOdds on each affected item).
                        Mirrors the real bookmaker's "ticket offered, accept the
                        change" step instead of a plain error the person has to
                        decode and fix by hand. */}
                    {changedSelections.length > 0 && (
                        <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-2.5 text-xs">
                            <p className="text-amber-300 font-bold mb-0.5">
                                {changedSelections.length === 1 ? t('Kuota ndryshoi') : t('Kuotat ndryshuan ({n})', { n: changedSelections.length })}
                            </p>
                            <p className="text-amber-200/80 leading-snug">
                                {t("Çmimi u përditësua më poshtë. Prano ndryshimet dhe vendos biletën sërish, ose hiqe zgjedhjen nëse s'e pranon.")}
                            </p>
                        </div>
                    )}

                    {hasConflicts && (
                        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-2.5 text-xs">
                            <p className="text-red-300 font-bold mb-0.5">{t('Zgjedhjet nuk mund të kombinohen')}</p>
                            <p className="text-red-200/80 leading-snug">
                                {t('Disa zgjedhje të së njëjtës ndeshje janë të lidhura logjikisht me njëra-tjetrën (njëra vendos ose mbulon tjetrën), ndaj kuota totale do të ishte e gabuar. Hiq njërën nga zgjedhjet e shënuara me të kuqe për të vendosur biletën.')}
                            </p>
                        </div>
                    )}

                    {/* List of Selections — numbered, since accumulator legs are a real sequence on the ticket */}
                    {selections.map((sel, idx) => (
                        <div key={`${sel.matchId}-${sel.marketId}-${sel.selectionId}`} className={`bg-brand-bg rounded-lg relative group flex animate-slip-in ${conflicts.has(legKey(sel)) ? 'ring-1 ring-red-500/70' : sel.previousOdds != null ? 'ring-1 ring-amber-500/60' : ''}`}>
                             <div className="w-6 flex-shrink-0 bg-brand-yellow/90 text-brand-bg font-extrabold text-xs flex items-center justify-center rounded-l-lg">
                                {idx + 1}
                             </div>
                             <div className="flex-1 p-2 pr-6 min-w-0">
                                 <div className="font-bold text-brand-text truncate">{sel.selectionName}</div>
                                 <div className="text-xs text-brand-textMuted truncate">{sel.marketName}</div>
                                 <div className="text-xs text-brand-textMuted italic truncate"><MatchupLabel home={sel.matchHome} away={sel.matchAway} /></div>
                                 {conflicts.has(legKey(sel)) && (
                                     <div className="text-[11px] text-red-300 mt-1 leading-snug">
                                         {t('Lidhet me: {list}', { list: (conflicts.get(legKey(sel)) || []).map((o) => `${o.marketName} - ${o.selectionName}`).join(', ') })}
                                     </div>
                                 )}
                                 <div className="text-right mt-1 tabular-nums">
                                     {sel.previousOdds != null && (
                                         <span className="text-brand-textMuted line-through mr-1.5">@{sel.previousOdds.toFixed(2)}</span>
                                     )}
                                     <span className={`font-bold ${sel.previousOdds != null ? 'text-amber-400' : 'text-brand-yellow'}`}>@{sel.odds.toFixed(2)}</span>
                                 </div>
                             </div>
                             <button
                                onClick={() => onRemoveSelection(`${sel.matchId}-${sel.marketId}-${sel.selectionId}`)}
                                aria-label={t('Hiq nga bileta')}
                                className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full text-brand-textMuted hover:text-white hover:bg-white/10 transition-colors"
                             >✕</button>
                        </div>
                    ))}

                    {/* Stake Section — separated by a dashed tear-line like a real slip */}
                    <div className="relative bg-brand-bg rounded-lg mt-4 border border-brand-divider">
                        <div className="absolute -left-2 top-0 w-4 h-4 rounded-full bg-brand-panel" />
                        <div className="absolute -right-2 top-0 w-4 h-4 rounded-full bg-brand-panel" />
                        <div className="border-t border-dashed border-brand-divider mx-4" />
                        <div className="p-3">
                            <div className="flex justify-between items-center mb-2">
                                <span className="font-bold text-white">{isSameGameMultiple ? `Same Game Multiple (${selections.length})` : isAccumulator ? t('{n}-Fish', { n: selections.length }) : t('Bast i Thjeshtë')}</span>
                                <span className="bg-brand-yellow text-brand-bg px-2 py-0.5 rounded font-bold text-xs tabular-nums">@{totalOdds.toFixed(2)}</span>
                            </div>
                            {isSameGameMultiple && (
                                <div className="text-[10px] text-brand-textMuted italic mb-2 leading-snug">
                                    {t("Kuotë e vlerësuar (shumëzim i kuotave individuale) — asnjë provider nuk jep çmim të dedikuar SGM, kështu që ky kombinim s'e llogarit varësinë mes rezultateve në të njëjtën ndeshje.")}
                                </div>
                            )}

                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-brand-textMuted w-12">Stake</span>
                                <div className="flex-1 relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-textMuted font-bold text-xs">L</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        value={stake}
                                        onChange={(e) => setStake(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full bg-brand-panel border border-brand-divider rounded-lg py-2 pl-6 pr-2 text-white font-bold tabular-nums focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow outline-none transition-colors"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-between text-xs text-brand-textMuted mb-4">
                                <span>{t('Fitimi i Mundshëm')}</span>
                                <span className="text-brand-text font-bold tabular-nums">{potentialReturn} L</span>
                            </div>

                            <button
                                onClick={handlePlaceBetClick}
                                disabled={!isValidStake}
                                className="w-full bg-brand-yellow hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-brand-bg font-extrabold py-2.5 rounded-lg shadow-md shadow-brand-yellow/10 transition-all active:scale-[0.98]"
                            >
                                {changedSelections.length > 0 ? t('Prano Ndryshimet & Vendos') : t('Vendos Biletën')}
                            </button>
                            {hasConflicts && (
                                <p className="text-red-400 text-xs text-center mt-2">{t('Hiq zgjedhjet e lidhura për të vendosur biletën')}</p>
                            )}
                            {!isValidStake && stake && stakeNum > userBalance && (
                                <p className="text-red-400 text-xs text-center mt-2">{t('Fonde të pamjaftueshme')}</p>
                            )}
                            {exceedsMaxStake && (
                                <p className="text-red-400 text-xs text-center mt-2">
                                    {t('Stake maksimal për një biletë është')} {MAX_STAKE.toLocaleString('en-US')} L
                                </p>
                            )}
                            {exceedsMaxReturn && !exceedsMaxStake && (
                                <p className="text-red-400 text-xs text-center mt-2">
                                    {t('Fitimi maksimal për një biletë është')} {MAX_POTENTIAL_RETURN.toLocaleString('en-US')} L. {t('Ul stake-un ose hiq zgjedhje.')}
                                </p>
                            )}
                            {!isValidStake && !exceedsMaxReturn && !exceedsMaxStake && stake && stakeNum <= userBalance && stakeNum > 0 && (
                                <p className="text-red-400 text-xs text-center mt-2">
                                    {!hasValidDecimals ? 'Maksimumi 2 shifra pas presjes' : `Stake minimal është ${MIN_STAKE} L`}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
          </>
        ) : (
            <div className="space-y-3">
                {myBets.length === 0 && (
                    <div className="flex flex-col items-center text-center mt-14 px-4">
                        <div className="w-12 h-12 rounded-full border-2 border-dashed border-brand-divider flex items-center justify-center text-brand-textMuted text-lg mb-3">🎟</div>
                        <p className="text-brand-text font-bold mb-1">{t("Ende s'ke bileta")}</p>
                        <p className="text-brand-textMuted text-xs leading-relaxed">{t('Biletat e vendosura shfaqen këtu, me statusin e tyre në kohë reale.')}</p>
                    </div>
                )}
                {myBets.map(bet => {
                    const canCancel = bet.status === BetStatus.PENDING && bet.cancellable === true && (Date.now() - bet.timestamp < 10 * 60 * 1000);
                    const partialLoss = bet.status === BetStatus.WON && Number(bet.potentialReturn) < Number(bet.stake); // half-lost leg: part of the stake came back
                    const statusLabel = bet.status === BetStatus.PENDING ? t('Hapur') : partialLoss ? t('Humbje e pjesshme') : bet.status === BetStatus.WON ? t('Fituar') : bet.status === BetStatus.VOID ? t('Rimbursuar') : t('Humbur');
                    const statusColor = bet.status === BetStatus.WON ? 'border-brand-accent' : bet.status === BetStatus.LOST ? 'border-red-500' : bet.status === BetStatus.VOID ? 'border-gray-500' : 'border-brand-yellow';
                    return (
                        <div key={bet.id} onClick={() => setOpenTicket({ id: bet.id, createdAt: bet.timestamp, status: bet.status, stake: bet.stake, totalOdds: bet.totalOdds, potentialReturn: bet.potentialReturn, legs: bet.selections })} className={`bg-brand-bg border-l-4 ${statusColor} border-y border-r border-brand-divider rounded-lg p-2 text-xs relative cursor-pointer hover:bg-brand-panel/60`} title={t('Hap biletën')}>
                            <div className="flex justify-between mb-2 border-b border-brand-divider pb-1.5">
                                <span className="text-brand-textMuted tabular-nums">{new Date(bet.timestamp).toLocaleDateString(locale, { timeZone: 'Europe/Tirane' })} {new Date(bet.timestamp).toLocaleTimeString(locale, { timeZone: 'Europe/Tirane', hour: '2-digit', minute: '2-digit' })}</span>
                                <span className={`font-bold uppercase text-[10px] tracking-wide px-1.5 py-0.5 rounded ${bet.status === BetStatus.WON ? 'bg-brand-accent/15 text-brand-accent' : bet.status === BetStatus.LOST ? 'bg-red-500/15 text-red-400' : bet.status === BetStatus.VOID ? 'bg-gray-500/20 text-gray-300' : 'bg-brand-yellow/15 text-brand-yellow'}`}>
                                    {statusLabel}
                                </span>
                            </div>

                            {/* Selections within the ticket */}
                            <div className="space-y-1.5 mb-2">
                                {bet.selections.map((leg, idx) => (
                                    <div key={idx} className="flex justify-between items-start gap-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-white truncate">{leg.selectionName} <span className="font-normal text-brand-textMuted">@{leg.odds.toFixed(2)}</span></div>
                                            <div className="text-[10px] text-brand-textMuted truncate">{leg.marketName} - <MatchupLabel home={leg.matchHome} away={leg.matchAway} size="xs" /></div>
                                        </div>
                                        <div className="text-[10px] flex-shrink-0">
                                            {bet.status !== BetStatus.PENDING && (
                                                <span className={leg.status === BetStatus.WON || leg.status === BetStatus.HALF_WON ? 'text-brand-accent' : leg.status === BetStatus.LOST || leg.status === BetStatus.HALF_LOST ? 'text-red-400' : 'text-gray-500'}>
                                                    {leg.status === BetStatus.PENDING ? '' : leg.status === BetStatus.WON ? t('Fituar') : leg.status === BetStatus.HALF_WON ? t('Gjysmë fitore') : leg.status === BetStatus.HALF_LOST ? t('Gjysmë humbje') : leg.status === BetStatus.VOID ? t('Rimbursuar') : t('Humbur')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-between items-center pt-1.5 border-t border-dashed border-brand-divider">
                                <div>
                                    <span className="font-bold text-white mr-2 tabular-nums">Stake: {bet.stake} L</span>
                                    <span className="font-bold text-brand-yellow tabular-nums">Ret: {bet.potentialReturn.toFixed(2)} L</span>
                                </div>
                                {canCancel && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onCancelBet(bet.id, 'USER'); }}
                                        className="bg-red-900/40 hover:bg-red-800 text-red-200 border border-red-800 px-2 py-0.5 rounded-md text-[10px] transition-colors"
                                    >
                                        {t('Anulo Biletën')}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
      </div>
      <TicketDetailModal ticket={openTicket} onClose={() => setOpenTicket(null)} />
    </div>
  );
};

export default BetSlip;