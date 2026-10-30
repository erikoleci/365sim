import React from 'react';
import BetSlip from '../BetSlip';
import { Bet, BetSelectionItem } from '../../types';

interface Props {
  selections: BetSelectionItem[];
  myBets: Bet[];
  userBalance: number;
  userBalanceEur?: number;
  betError: string | null;
  isMobileSlipOpen: boolean;
  onOpenMobileSlip: () => void;
  onCloseMobileSlip: () => void;
  onRemoveSelection: (key: string) => void;
  onClearAll: () => void;
  onPlaceBet: (stake: number, type: 'SINGLE' | 'ACCUMULATOR', currency: 'ALL' | 'EUR') => void;
  onCancelBet: (betId: string, origin: 'USER' | 'ADMIN') => void;
  hasLiveSelection?: boolean;
}

const ErrorBanner: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div className="bg-red-900/30 border-b border-red-900/50 text-red-300 text-xs p-2 text-center">{message}</div>
  ) : null;

/**
 * The bet slip: a sticky column on desktop, and on phones a floating button with the selection
 * count that opens the slip full screen (it has its own address, /kuponi).
 */
const BetSlipPanels: React.FC<Props> = ({
  selections, myBets, userBalance, userBalanceEur = 0, betError, isMobileSlipOpen, onOpenMobileSlip, onCloseMobileSlip,
  onRemoveSelection, onClearAll, onPlaceBet, onCancelBet, hasLiveSelection = false,
}) => {
  const slip = (
    <BetSlip
      selections={selections}
      onRemoveSelection={onRemoveSelection}
      onClearAll={onClearAll}
      onPlaceBet={onPlaceBet}
      onCancelBet={onCancelBet}
      userBalance={userBalance}
      userBalanceEur={userBalanceEur}
      myBets={myBets}
      hasLiveSelection={hasLiveSelection}
    />
  );

  return (
    <>
      <aside className="w-80 hidden md:flex flex-col flex-shrink-0">
        <div className="bg-brand-panel rounded overflow-hidden shadow-sm flex-1 max-h-[calc(100vh-100px)] sticky top-20">
          <ErrorBanner message={betError} />
          {slip}
        </div>
      </aside>

      <div className="fixed bottom-4 right-4 md:hidden z-40">
        <button
          onClick={onOpenMobileSlip}
          className="bg-brand-yellow text-black font-bold rounded-full w-14 h-14 shadow-2xl flex items-center justify-center relative border-2 border-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          {selections.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {selections.length}
            </span>
          )}
        </button>
      </div>

      {isMobileSlipOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-black/50 backdrop-blur-sm flex justify-end animate-in slide-in-from-bottom">
          <div className="w-full h-full bg-brand-panel flex flex-col">
            <div className="flex justify-between items-center p-4 bg-brand-header text-white shadow-lg">
              <span className="font-bold">Bet Slip</span>
              <button onClick={onCloseMobileSlip} className="text-white font-bold p-2">Close &times;</button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ErrorBanner message={betError} />
              {slip}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BetSlipPanels;
