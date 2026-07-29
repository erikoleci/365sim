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

const QUICK_STAKES = [50, 100, 250, 500];

const BetSlip: React.FC<BetSlipProps> = ({ selections, onRemoveSelection, onClearAll, onPlaceBet, onCancelBet, userBalance, myBets }) => {
  const [stake, setStake] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'slip' | 'mybets'>('slip');
  const [showConfirm, setShowConfirm] = useState(false);

  // Force re-render to update timers for "Cancel" button visibility
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selections.length > 0) setActiveTab('slip');
  }, [selections.length]);

  const totalOdds = selections.reduce((acc, curr) => acc * curr.odds, 1);
  const isAccumulator = selections.length > 1;
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

  return (
    <div className="bg-brand-header h-full flex flex-col border-l border-brand-border text-sm relative">
      {/* Confirmation Modal Overlay */}
      {showConfirm && (
        <div className="absolute inset-0 bg-brand-bg/95 backdrop-blur z-20 flex flex-col items-center justify-center p-5 text-center animate-fadeIn">
          <h3 className="text-brand-text font-display font-bold text-lg mb-4">Konfirmo Bastin</h3>
          <div className="bg-brand-surface border border-brand-border p-4 rounded-xl w-full mb-4">
            <div className="flex justify-between mb-2 text-brand-textMuted text-xs">
              <span>Stakë</span>
              <span className="text-brand-text font-bold tabular-nums">{parseFloat(stake).toFixed(2)} L</span>
            </div>
            <div className="flex justify-between mb-2 text-brand-textMuted text-xs">
              <span>Kuota Totale</span>
              <span className="text-brand-yellow font-bold tabular-nums">@{totalOdds.toFixed(2)}</span>
            </div>
            <div className="border-t border-brand-border pt-2 flex justify-between text-sm">
              <span className="text-brand-text">Fitim i mundshëm</span>
              <span className="text-brand-accent font-bold tabular-nums">{potentialReturn} L</span>
            </div>
          </div>
          <div className="flex gap-2 w-full">
            <button onClick={() => setShowConfirm(false)} className="flex-1 bg-brand-surface2 hover:bg-brand-surfaceHover text-brand-text py-2.5 rounded-lg font-semibold border border-brand-border">
              Anulo
            </button>
            <button onClick={confirmBet} className="flex-1 bg-brand-accent hover:bg-brand-accentDark text-brand-bg py-2.5 rounded-lg font-bold">
              Konfirmo
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-brand-border p-1.5 gap-1">
        <button
          className={`flex-1 py-2 rounded-lg font-semibold text-center transition-colors ${
            activeTab === 'slip' ? 'bg-brand-accentSoft text-brand-accent' : 'text-brand-textMuted hover:bg-brand-surfaceHover'
          }`}
          onClick={() => setActiveTab('slip')}
        >
          Kuponi {selections.length > 0 && <span className="ml-1 bg-brand-accent text-brand-bg px-1.5 rounded-full text-xs">{selections.length}</span>}
        </button>
        <button
          className={`flex-1 py-2 rounded-lg font-semibold text-center transition-colors ${
            activeTab === 'mybets' ? 'bg-brand-accentSoft text-brand-accent' : 'text-brand-textMuted hover:bg-brand-surfaceHover'
          }`}
          onClick={() => setActiveTab('mybets')}
        >
          Bastet e Mia
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'slip' ? (
          <>
            {selections.length === 0 ? (
              <div className="flex flex-col items-center text-center text-brand-textFaint mt-16 gap-3">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm">Kliko mbi kuotat për të shtuar zgjedhje</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button onClick={onClearAll} className="text-xs text-brand-textFaint hover:text-brand-text">
                    Hiq të gjitha
                  </button>
                </div>

                {selections.map((sel) => (
                  <div key={`${sel.matchId}-${sel.marketId}-${sel.selectionId}`} className="bg-brand-surface p-2.5 rounded-xl border border-brand-border relative">
                    <button
                      onClick={() => onRemoveSelection(`${sel.matchId}-${sel.marketId}-${sel.selectionId}`)}
                      className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full text-brand-textFaint hover:text-brand-text hover:bg-brand-surfaceHover"
                    >
                      ✕
                    </button>
                    <div className="font-bold text-brand-text pr-5 text-sm">{sel.selectionName}</div>
                    <div className="text-xs text-brand-textMuted">{sel.marketName}</div>
                    <div className="text-xs text-brand-textFaint italic truncate">{sel.matchHome} v {sel.matchAway}</div>
                    <div className="text-right font-bold text-brand-accent mt-1 tabular-nums">@{sel.odds.toFixed(2)}</div>
                  </div>
                ))}

                <div className="bg-brand-surface p-3 rounded-xl border border-brand-border mt-3">
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-semibold text-brand-text text-sm">{isAccumulator ? `${selections.length}-Fold Kombo` : 'Bast i Vetëm'}</span>
                    <span className="bg-brand-accentSoft text-brand-accent px-2 py-0.5 rounded-lg font-bold text-xs tabular-nums">@{totalOdds.toFixed(2)}</span>
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-textFaint font-semibold text-xs">L</span>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={stake}
                        onChange={(e) => setStake(e.target.value)}
                        className="w-full bg-brand-surface2 border border-brand-border rounded-lg py-2.5 pl-7 pr-3 text-brand-text tabular-nums focus:border-brand-accent outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {/* Quick stake chips reduce input friction for the most common amounts */}
                  <div className="flex gap-1.5 mb-3">
                    {QUICK_STAKES.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setStake(String(amt))}
                        className="flex-1 py-1.5 rounded-lg bg-brand-surface2 hover:bg-brand-surfaceHover text-brand-textMuted hover:text-brand-text text-xs font-semibold border border-brand-border transition-colors"
                      >
                        {amt}
                      </button>
                    ))}
                    <button
                      onClick={() => setStake(String(Math.floor(userBalance)))}
                      className="flex-1 py-1.5 rounded-lg bg-brand-surface2 hover:bg-brand-surfaceHover text-brand-textMuted hover:text-brand-text text-xs font-semibold border border-brand-border transition-colors"
                    >
                      Max
                    </button>
                  </div>

                  <div className="flex justify-between text-xs text-brand-textMuted mb-3">
                    <span>Fitim i mundshëm</span>
                    <span className="text-brand-text font-bold tabular-nums">{potentialReturn} L</span>
                  </div>

                  <button
                    onClick={handlePlaceBetClick}
                    disabled={!isValidStake}
                    className="w-full bg-brand-accent hover:bg-brand-accentDark disabled:opacity-40 disabled:cursor-not-allowed text-brand-bg font-bold py-3 rounded-lg transition-colors"
                  >
                    Vendos Bastin
                  </button>
                  {!isValidStake && stake && parseFloat(stake) > userBalance && (
                    <p className="text-brand-danger text-xs text-center mt-2">Fonde të pamjaftueshme</p>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {myBets.length === 0 && <div className="text-center text-brand-textFaint mt-16 text-sm">Nuk ka histori tiketash.</div>}
            {myBets.map((bet) => {
              const canCancel = bet.status === BetStatus.PENDING && Date.now() - bet.timestamp < 10 * 60 * 1000;
              const statusLabel = bet.status === BetStatus.PENDING ? 'Hapur' : bet.status === BetStatus.WON ? 'Fituar' : 'Humbur';
              const statusColor = bet.status === BetStatus.WON ? 'text-brand-accent' : bet.status === BetStatus.LOST ? 'text-brand-danger' : 'text-brand-textMuted';
              return (
                <div key={bet.id} className="bg-brand-surface border border-brand-border rounded-xl p-3 text-xs">
                  <div className="flex justify-between mb-2 border-b border-brand-border pb-2">
                    <span className="text-brand-textFaint">
                      {new Date(bet.timestamp).toLocaleDateString('sq-AL', { timeZone: 'Europe/Tirane' })}{' '}
                      {new Date(bet.timestamp).toLocaleTimeString('sq-AL', { timeZone: 'Europe/Tirane', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`font-bold ${statusColor}`}>{statusLabel}</span>
                  </div>

                  <div className="space-y-1.5 mb-2">
                    {bet.selections.map((leg, idx) => (
                      <div key={idx} className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-brand-text">
                            {leg.selectionName} <span className="font-normal text-brand-textMuted">@{leg.odds.toFixed(2)}</span>
                          </div>
                          <div className="text-[10px] text-brand-textFaint">{leg.marketName} · {leg.matchHome} v {leg.matchAway}</div>
                        </div>
                        {bet.status !== BetStatus.PENDING && (
                          <span className={`text-[10px] ${leg.status === BetStatus.WON ? 'text-brand-accent' : leg.status === BetStatus.LOST ? 'text-brand-danger' : 'text-brand-textFaint'}`}>
                            {leg.status === BetStatus.PENDING ? '' : leg.status === BetStatus.WON ? 'Fituar' : 'Humbur'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-brand-border">
                    <div>
                      <span className="font-semibold text-brand-text mr-2 tabular-nums">Stakë: {bet.stake} L</span>
                      <span className="font-semibold text-brand-yellow tabular-nums">Rikth: {bet.potentialReturn.toFixed(2)} L</span>
                    </div>
                    {canCancel && (
                      <button
                        onClick={() => onCancelBet(bet.id, 'USER')}
                        className="bg-brand-danger/10 hover:bg-brand-danger/20 text-brand-danger border border-brand-danger/30 px-2 py-1 rounded-lg text-[10px] font-semibold"
                      >
                        Anulo Tiketën
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
