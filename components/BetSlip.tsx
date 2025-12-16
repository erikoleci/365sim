import React, { useState } from 'react';
import { BetSelectionItem, Bet, BetStatus } from '../types';

interface BetSlipProps {
  selections: BetSelectionItem[];
  onRemoveSelection: (uniqueId: string) => void;
  onClearAll: () => void;
  onPlaceBet: (stake: number, type: 'SINGLE' | 'ACCUMULATOR') => void;
  userBalance: number;
  myBets: Bet[];
}

const BetSlip: React.FC<BetSlipProps> = ({ selections, onRemoveSelection, onClearAll, onPlaceBet, userBalance, myBets }) => {
  const [stake, setStake] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'slip' | 'mybets'>('slip');

  // Auto switch to slip if selection made
  React.useEffect(() => {
    if (selections.length > 0) setActiveTab('slip');
  }, [selections.length]);

  const totalOdds = selections.reduce((acc, curr) => acc * curr.odds, 1);
  const isAccumulator = selections.length > 1;
  const potentialReturn = (parseFloat(stake || '0') * totalOdds).toFixed(2);
  const isValidStake = parseFloat(stake || '0') > 0 && parseFloat(stake || '0') <= userBalance;

  const handlePlaceBet = () => {
    if (!stake || !isValidStake) return;
    onPlaceBet(parseFloat(stake), isAccumulator ? 'ACCUMULATOR' : 'SINGLE');
    setStake('');
  };

  return (
    <div className="bg-brand-panel h-full flex flex-col border-l border-brand-divider text-sm">
      {/* Tabs */}
      <div className="flex border-b border-brand-divider">
        <button 
            className={`flex-1 py-3 font-bold text-center ${activeTab === 'slip' ? 'bg-brand-header text-white' : 'text-brand-textMuted hover:bg-brand-bg'}`}
            onClick={() => setActiveTab('slip')}
        >
            Bet Slip {selections.length > 0 && <span className="ml-1 bg-brand-yellow text-brand-bg px-1.5 rounded-full text-xs">{selections.length}</span>}
        </button>
        <button 
            className={`flex-1 py-3 font-bold text-center ${activeTab === 'mybets' ? 'bg-brand-header text-white' : 'text-brand-textMuted hover:bg-brand-bg'}`}
            onClick={() => setActiveTab('mybets')}
        >
            My Bets
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'slip' ? (
          <>
            {selections.length === 0 ? (
                <div className="text-center text-brand-textMuted mt-10">
                    <p>Click prices to add selections</p>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex justify-end">
                         <button onClick={onClearAll} className="text-[10px] text-brand-textMuted hover:text-white underline">Remove All</button>
                    </div>

                    {/* List of Selections */}
                    {selections.map((sel, idx) => (
                        <div key={`${sel.matchId}-${sel.marketId}-${sel.selectionId}`} className="bg-brand-bg p-2 rounded border-l-4 border-brand-yellow relative group">
                             <button 
                                onClick={() => onRemoveSelection(`${sel.matchId}-${sel.marketId}-${sel.selectionId}`)}
                                className="absolute top-1 right-2 text-brand-textMuted hover:text-white font-bold"
                             >✕</button>
                             <div className="font-bold text-brand-text pr-4">{sel.selectionName}</div>
                             <div className="text-xs text-brand-textMuted">{sel.marketName}</div>
                             <div className="text-xs text-brand-textMuted italic">{sel.matchHome} v {sel.matchAway}</div>
                             <div className="text-right font-bold text-brand-yellow mt-1">@{sel.odds.toFixed(2)}</div>
                        </div>
                    ))}

                    {/* Stake Section */}
                    <div className="bg-brand-bg p-3 rounded border border-brand-divider mt-4">
                        <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-white">{isAccumulator ? `${selections.length}-Fold Accumulator` : 'Single Bet'}</span>
                            <span className="bg-brand-yellow text-brand-bg px-2 py-0.5 rounded font-bold text-xs">@{totalOdds.toFixed(2)}</span>
                        </div>

                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-brand-textMuted w-12">Stake</span>
                            <div className="flex-1 relative">
                                <span className="absolute left-2 top-1.5 text-brand-textMuted font-bold">L</span>
                                <input 
                                    type="number" 
                                    value={stake}
                                    onChange={(e) => setStake(e.target.value)}
                                    className="w-full bg-brand-panel border border-brand-divider rounded p-1.5 pl-5 text-white focus:border-brand-yellow outline-none"
                                />
                            </div>
                        </div>
                        
                        <div className="flex justify-between text-xs text-brand-textMuted mb-4">
                            <span>To Return:</span>
                            <span className="text-brand-text font-bold">{potentialReturn} L</span>
                        </div>

                        <button 
                            onClick={handlePlaceBet}
                            disabled={!isValidStake}
                            className="w-full bg-brand-yellow hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-brand-bg font-bold py-2 rounded shadow-sm"
                        >
                            Place Bet
                        </button>
                        {!isValidStake && stake && parseFloat(stake) > userBalance && (
                            <p className="text-red-400 text-xs text-center mt-2">Insufficient Funds</p>
                        )}
                    </div>
                </div>
            )}
          </>
        ) : (
            <div className="space-y-3">
                {myBets.length === 0 && <div className="text-center text-brand-textMuted mt-10">No bets history</div>}
                {myBets.map(bet => (
                    <div key={bet.id} className="bg-brand-bg border border-brand-divider rounded p-2 text-xs">
                        <div className="flex justify-between mb-2 border-b border-brand-divider pb-1">
                             <span className="text-brand-textMuted">{new Date(bet.timestamp).toLocaleDateString()}</span>
                             <span className={`font-bold ${bet.status === BetStatus.WON ? 'text-brand-accent' : bet.status === BetStatus.LOST ? 'text-red-400' : 'text-brand-textMuted'}`}>
                                {bet.status === BetStatus.PENDING ? 'Open' : bet.status}
                             </span>
                        </div>
                        
                        {/* Selections within the ticket */}
                        <div className="space-y-1 mb-2">
                             {bet.selections.map((leg, idx) => (
                                <div key={idx} className="flex justify-between items-start">
                                    <div>
                                        <div className="font-bold text-white">{leg.selectionName} <span className="font-normal text-brand-textMuted">@{leg.odds.toFixed(2)}</span></div>
                                        <div className="text-[10px] text-brand-textMuted">{leg.marketName} - {leg.matchHome} v {leg.matchAway}</div>
                                    </div>
                                    <div className="text-[10px]">
                                        {bet.status !== BetStatus.PENDING && (
                                            <span className={leg.status === BetStatus.WON ? 'text-brand-accent' : leg.status === BetStatus.LOST ? 'text-red-400' : 'text-gray-500'}>
                                                {leg.status === BetStatus.PENDING ? '' : leg.status}
                                            </span>
                                        )}
                                    </div>
                                </div>
                             ))}
                        </div>

                        <div className="flex justify-between pt-1 border-t border-brand-divider bg-brand-panel/50 p-1 -mx-2 -mb-2 rounded-b">
                            <span className="font-bold text-white">Stake: {bet.stake} L</span>
                            <span className="font-bold text-brand-yellow">Ret: {bet.potentialReturn.toFixed(2)} L</span>
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
};

export default BetSlip;