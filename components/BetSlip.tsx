import React, { useState, useEffect } from 'react';
import { BetSelectionItem, Bet, BetStatus } from '../types';

interface BetSlipProps {
  selections: BetSelectionItem[];
  onRemoveSelection: (uniqueId: string) => void;
  onClearAll: () => void;
  onPlaceBet: (stake: number, type: 'SINGLE' | 'ACCUMULATOR') => void;
  onCancelBet: (betId: string, origin: 'USER' | 'ADMIN') => void;
  userBalance: number;
  myBets: Bet[];
}

const BetSlip: React.FC<BetSlipProps> = ({ selections, onRemoveSelection, onClearAll, onPlaceBet, onCancelBet, userBalance, myBets }) => {
  const [stake, setStake] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'slip' | 'mybets'>('slip');
  const [showConfirm, setShowConfirm] = useState(false);
  
  // Force re-render to update timers for "Cancel" button visibility
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30000); // Check every 30s
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
  const isValidStake = parseFloat(stake || '0') > 0 && parseFloat(stake || '0') <= userBalance;

  const handlePlaceBetClick = () => {
    if (!stake || !isValidStake) return;
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
              <h3 className="text-white font-bold text-lg mb-4 tracking-tight">Konfirmo Biletën</h3>
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
                        <span>Kuota Totale</span>
                        <span className="text-brand-yellow font-bold tabular-nums">@{totalOdds.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-dashed border-brand-divider" />
                    <div className="flex justify-between pt-3">
                        <span className="text-brand-text">Fitimi i Mundshëm</span>
                        <span className="text-brand-accent font-bold text-base tabular-nums">{potentialReturn} L</span>
                    </div>
                  </div>
              </div>
              <div className="flex gap-2 w-full">
                  <button onClick={cancelConfirm} className="flex-1 bg-transparent border border-brand-divider hover:border-white text-brand-text py-2.5 rounded-lg font-bold transition-colors">Anulo</button>
                  <button onClick={confirmBet} className="flex-1 bg-brand-yellow hover:bg-yellow-400 text-brand-bg py-2.5 rounded-lg font-bold shadow-lg shadow-brand-yellow/10 transition-colors">Vendos Biletën</button>
              </div>
          </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-brand-divider">
        <button
            className={`flex-1 py-3 font-bold text-center transition-colors relative ${activeTab === 'slip' ? 'bg-brand-header text-white' : 'text-brand-textMuted hover:bg-brand-bg'}`}
            onClick={() => setActiveTab('slip')}
        >
            Bileta {selections.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] bg-brand-yellow text-brand-bg rounded-full text-[11px] font-extrabold">{selections.length}</span>}
        </button>
        <button
            className={`flex-1 py-3 font-bold text-center transition-colors ${activeTab === 'mybets' ? 'bg-brand-header text-white' : 'text-brand-textMuted hover:bg-brand-bg'}`}
            onClick={() => setActiveTab('mybets')}
        >
            Biletat e Mia
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
                    <p className="text-brand-text font-bold mb-1">Bileta jote është bosh</p>
                    <p className="text-brand-textMuted text-xs leading-relaxed">Zgjidh një kuotë nga tabela e ndeshjeve për ta shtuar këtu.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex justify-end">
                         <button onClick={onClearAll} className="text-[11px] text-brand-textMuted hover:text-white transition-colors">Hiq të Gjitha</button>
                    </div>

                    {/* List of Selections — numbered, since accumulator legs are a real sequence on the ticket */}
                    {selections.map((sel, idx) => (
                        <div key={`${sel.matchId}-${sel.marketId}-${sel.selectionId}`} className="bg-brand-bg rounded-lg relative group flex animate-slip-in">
                             <div className="w-6 flex-shrink-0 bg-brand-yellow/90 text-brand-bg font-extrabold text-xs flex items-center justify-center rounded-l-lg">
                                {idx + 1}
                             </div>
                             <div className="flex-1 p-2 pr-6 min-w-0">
                                 <div className="font-bold text-brand-text truncate">{sel.selectionName}</div>
                                 <div className="text-xs text-brand-textMuted truncate">{sel.marketName}</div>
                                 <div className="text-xs text-brand-textMuted italic truncate">{sel.matchHome} v {sel.matchAway}</div>
                                 <div className="text-right font-bold text-brand-yellow mt-1 tabular-nums">@{sel.odds.toFixed(2)}</div>
                             </div>
                             <button
                                onClick={() => onRemoveSelection(`${sel.matchId}-${sel.marketId}-${sel.selectionId}`)}
                                aria-label="Hiq nga bileta"
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
                                <span className="font-bold text-white">{isSameGameMultiple ? `Same Game Multiple (${selections.length})` : isAccumulator ? `${selections.length}-Fish` : 'Bast i Thjeshtë'}</span>
                                <span className="bg-brand-yellow text-brand-bg px-2 py-0.5 rounded font-bold text-xs tabular-nums">@{totalOdds.toFixed(2)}</span>
                            </div>
                            {isSameGameMultiple && (
                                <div className="text-[10px] text-brand-textMuted italic mb-2 leading-snug">
                                    Kuotë e vlerësuar (shumëzim i kuotave individuale) — asnjë provider nuk jep çmim të dedikuar SGM, kështu që ky kombinim s'e llogarit varësinë mes rezultateve në të njëjtën ndeshje.
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
                                <span>Fitimi i Mundshëm</span>
                                <span className="text-brand-text font-bold tabular-nums">{potentialReturn} L</span>
                            </div>

                            <button
                                onClick={handlePlaceBetClick}
                                disabled={!isValidStake}
                                className="w-full bg-brand-yellow hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-brand-bg font-extrabold py-2.5 rounded-lg shadow-md shadow-brand-yellow/10 transition-all active:scale-[0.98]"
                            >
                                Vendos Biletën
                            </button>
                            {!isValidStake && stake && parseFloat(stake) > userBalance && (
                                <p className="text-red-400 text-xs text-center mt-2">Fonde të pamjaftueshme</p>
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
                        <p className="text-brand-text font-bold mb-1">Ende s'ke bileta</p>
                        <p className="text-brand-textMuted text-xs leading-relaxed">Biletat e vendosura shfaqen këtu, me statusin e tyre në kohë reale.</p>
                    </div>
                )}
                {myBets.map(bet => {
                    const canCancel = bet.status === BetStatus.PENDING && (Date.now() - bet.timestamp < 10 * 60 * 1000);
                    const statusLabel = bet.status === BetStatus.PENDING ? 'Hapur' : bet.status === BetStatus.WON ? 'Fituar' : 'Humbur';
                    const statusColor = bet.status === BetStatus.WON ? 'border-brand-accent' : bet.status === BetStatus.LOST ? 'border-red-500' : 'border-brand-yellow';
                    return (
                        <div key={bet.id} className={`bg-brand-bg border-l-4 ${statusColor} border-y border-r border-brand-divider rounded-lg p-2 text-xs relative`}>
                            <div className="flex justify-between mb-2 border-b border-brand-divider pb-1.5">
                                <span className="text-brand-textMuted tabular-nums">{new Date(bet.timestamp).toLocaleDateString('sq-AL', { timeZone: 'Europe/Tirane' })} {new Date(bet.timestamp).toLocaleTimeString('sq-AL', { timeZone: 'Europe/Tirane', hour: '2-digit', minute: '2-digit' })}</span>
                                <span className={`font-bold uppercase text-[10px] tracking-wide px-1.5 py-0.5 rounded ${bet.status === BetStatus.WON ? 'bg-brand-accent/15 text-brand-accent' : bet.status === BetStatus.LOST ? 'bg-red-500/15 text-red-400' : 'bg-brand-yellow/15 text-brand-yellow'}`}>
                                    {statusLabel}
                                </span>
                            </div>

                            {/* Selections within the ticket */}
                            <div className="space-y-1.5 mb-2">
                                {bet.selections.map((leg, idx) => (
                                    <div key={idx} className="flex justify-between items-start gap-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-white truncate">{leg.selectionName} <span className="font-normal text-brand-textMuted">@{leg.odds.toFixed(2)}</span></div>
                                            <div className="text-[10px] text-brand-textMuted truncate">{leg.marketName} - {leg.matchHome} v {leg.matchAway}</div>
                                        </div>
                                        <div className="text-[10px] flex-shrink-0">
                                            {bet.status !== BetStatus.PENDING && (
                                                <span className={leg.status === BetStatus.WON ? 'text-brand-accent' : leg.status === BetStatus.LOST ? 'text-red-400' : 'text-gray-500'}>
                                                    {leg.status === BetStatus.PENDING ? '' : leg.status === BetStatus.WON ? 'Fituar' : 'Humbur'}
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
                                        onClick={() => onCancelBet(bet.id, 'USER')}
                                        className="bg-red-900/40 hover:bg-red-800 text-red-200 border border-red-800 px-2 py-0.5 rounded-md text-[10px] transition-colors"
                                    >
                                        Anulo Biletën
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
      </div>
    </div>
  );
};

export default BetSlip;