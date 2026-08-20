import React, { useState } from 'react';

interface VideoPokerProps {
  onBalanceUpdate: (amount: number) => void;
  userBalance: number;
  onClose: () => void;
}

type Card = { suit: string; value: string; id: number };
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const getCardColor = (suit: string) => (suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-black');

const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);
const mkCard = (suit: string, value: string): Card => ({ suit, value, id: Math.random() });

// Builders for genuine, internally-consistent 5-card winning hands. Only
// used for the ~1% of draws the house allows to win — every card in the
// returned hand really does form the named combination.
const buildJacksOrBetter = (): Card[] => {
  const rank = ['J', 'Q', 'K', 'A'][Math.floor(Math.random() * 4)];
  const suits = shuffle(SUITS).slice(0, 2);
  const pair = suits.map((s) => mkCard(s, rank));
  const otherRanks = shuffle(VALUES.filter((v) => v !== rank)).slice(0, 3);
  const fillers = otherRanks.map((v) => mkCard(SUITS[Math.floor(Math.random() * SUITS.length)], v));
  return shuffle([...pair, ...fillers]);
};
const buildTwoPair = (): Card[] => {
  const [rankA, rankB] = shuffle(VALUES).slice(0, 2);
  const pairA = shuffle(SUITS).slice(0, 2).map((s) => mkCard(s, rankA));
  const pairB = shuffle(SUITS).slice(0, 2).map((s) => mkCard(s, rankB));
  const filler = shuffle(VALUES.filter((v) => v !== rankA && v !== rankB))[0];
  return shuffle([...pairA, ...pairB, mkCard(SUITS[Math.floor(Math.random() * SUITS.length)], filler)]);
};
const buildThreeOfAKind = (): Card[] => {
  const rank = VALUES[Math.floor(Math.random() * VALUES.length)];
  const trips = shuffle(SUITS).slice(0, 3).map((s) => mkCard(s, rank));
  const otherRanks = shuffle(VALUES.filter((v) => v !== rank)).slice(0, 2);
  const fillers = otherRanks.map((v) => mkCard(SUITS[Math.floor(Math.random() * SUITS.length)], v));
  return shuffle([...trips, ...fillers]);
};
const buildFullHouse = (): Card[] => {
  const [rankA, rankB] = shuffle(VALUES).slice(0, 2);
  const trips = shuffle(SUITS).slice(0, 3).map((s) => mkCard(s, rankA));
  const pair = shuffle(SUITS).slice(0, 2).map((s) => mkCard(s, rankB));
  return shuffle([...trips, ...pair]);
};
const buildFourOfAKind = (): Card[] => {
  const rank = VALUES[Math.floor(Math.random() * VALUES.length)];
  const quads = SUITS.map((s) => mkCard(s, rank));
  const filler = shuffle(VALUES.filter((v) => v !== rank))[0];
  return shuffle([...quads, mkCard(SUITS[Math.floor(Math.random() * SUITS.length)], filler)]);
};
const pickConsecutiveRun = (excludeRoyal: boolean): string[] => {
  const maxStart = VALUES.length - 5; // 8 possible starting indices (0..8)
  const start = excludeRoyal ? Math.floor(Math.random() * maxStart) : maxStart; // maxStart(8) = 10,J,Q,K,A
  return VALUES.slice(start, start + 5);
};
const buildStraight = (): Card[] => {
  const ranks = pickConsecutiveRun(true);
  let suits = ranks.map(() => SUITS[Math.floor(Math.random() * SUITS.length)]);
  if (suits.every((s) => s === suits[0])) {
    suits[4] = SUITS[(SUITS.indexOf(suits[4]) + 1) % SUITS.length]; // avoid accidental straight flush
  }
  return shuffle(ranks.map((v, i) => mkCard(suits[i], v)));
};
const buildFlush = (): Card[] => {
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
  let ranks = shuffle(VALUES).slice(0, 5);
  const indices = ranks.map((v) => VALUES.indexOf(v)).sort((a, b) => a - b);
  const isConsecutive = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
  if (isConsecutive) ranks[0] = VALUES.find((v) => !ranks.includes(v))!; // avoid accidental straight flush
  return shuffle(ranks.map((v) => mkCard(suit, v)));
};
const buildStraightFlush = (): Card[] => {
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
  const ranks = pickConsecutiveRun(true);
  return shuffle(ranks.map((v) => mkCard(suit, v)));
};
const buildRoyalFlush = (): Card[] => {
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
  return shuffle(pickConsecutiveRun(false).map((v) => mkCard(suit, v)));
};

const WIN_TIERS: { name: string; mult: number; weight: number; build: () => Card[] }[] = [
  { name: 'ROYAL FLUSH', mult: 800, weight: 1, build: buildRoyalFlush },
  { name: 'STRAIGHT FLUSH', mult: 50, weight: 3, build: buildStraightFlush },
  { name: '4 OF A KIND', mult: 25, weight: 6, build: buildFourOfAKind },
  { name: 'FULL HOUSE', mult: 9, weight: 10, build: buildFullHouse },
  { name: 'FLUSH', mult: 6, weight: 12, build: buildFlush },
  { name: 'STRAIGHT', mult: 4, weight: 12, build: buildStraight },
  { name: '3 OF A KIND', mult: 3, weight: 20, build: buildThreeOfAKind },
  { name: '2 PAIR', mult: 2, weight: 16, build: buildTwoPair },
  { name: 'JACKS OR BETTER', mult: 1, weight: 20, build: buildJacksOrBetter },
];
const pickWeightedTier = () => {
  const totalWeight = WIN_TIERS.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * totalWeight;
  for (const tier of WIN_TIERS) {
    if (r < tier.weight) return tier;
    r -= tier.weight;
  }
  return WIN_TIERS[WIN_TIERS.length - 1];
};

const VideoPoker: React.FC<VideoPokerProps> = ({ onBalanceUpdate, userBalance, onClose }) => {
  const [hand, setHand] = useState<Card[]>([]);
  const [heldIndices, setHeldIndices] = useState<number[]>([]);
  const [gameStage, setGameStage] = useState<'BET' | 'DEAL' | 'DRAW' | 'OVER'>('BET');
  const [stake, setStake] = useState(10);
  const [message, setMessage] = useState('Jacks or Better');

  // Helper to generate a random card
  const getRandomCard = () => {
      const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
      const value = VALUES[Math.floor(Math.random() * VALUES.length)];
      return { suit, value, id: Math.random() };
  };

  const deal = () => {
      if (userBalance < stake) {
          setMessage('Insufficient Funds');
          return;
      }
      onBalanceUpdate(-stake);
      
      // Deal 5 random cards
      const newHand = Array.from({ length: 5 }, () => getRandomCard());
      setHand(newHand);
      setHeldIndices([]);
      setGameStage('DRAW');
      setMessage('Hold cards and Draw');
  };

  const toggleHold = (index: number) => {
      if (gameStage !== 'DRAW') return;
      if (heldIndices.includes(index)) {
          setHeldIndices(heldIndices.filter(i => i !== index));
      } else {
          setHeldIndices([...heldIndices, index]);
      }
  };

  const draw = () => {
      const WIN_CHANCE = 0.01;

      // ~1% of draws: build a genuine winning hand for visuals, but cap the
      // actual payout to a small profit (5%-50% of stake), not the full
      // paytable multiplier (which can run up to 800x on a Royal Flush).
      if (Math.random() < WIN_CHANCE) {
          const tier = pickWeightedTier();
          const newHand = tier.build();
          setHand(newHand);
          setHeldIndices([]);
          setGameStage('OVER');
          const win = Number((stake * (1.05 + Math.random() * 0.45)).toFixed(2));
          onBalanceUpdate(win);
          setMessage(`${tier.name}! WON ${win}`);
          return;
      }

      // 1. Generate new cards for unheld slots
      let newHand = hand.map((card, idx) => {
          if (heldIndices.includes(idx)) return card;
          return getRandomCard();
      });

      // 2. CHECK FOR WINNING HANDS AND BREAK THEM (house-controlled 99% loss path)
      // Sanitize Hand Logic:
      const values = newHand.map(c => c.value);
      
      // Check rank counts
      const counts: Record<string, number> = {};
      values.forEach(v => counts[v] = (counts[v] || 0) + 1);
      
      const winningValues = ['J', 'Q', 'K', 'A'];
      let hasWinningPair = false;
      winningValues.forEach(v => { if (counts[v] >= 2) hasWinningPair = true; });
      
      // If we accidentally gave them a winning hand, force it back to garbage.
      if (hasWinningPair || Object.values(counts).some(c => c >= 2)) {
          newHand = [
              { suit: '♠', value: '2', id: 1 },
              { suit: '♥', value: '4', id: 2 },
              { suit: '♣', value: '7', id: 3 },
              { suit: '♦', value: '9', id: 4 },
              { suit: '♠', value: 'Q', id: 5 }
          ];
          
          // Keep held cards visually, then break any pair they reintroduce.
          heldIndices.forEach(idx => {
              newHand[idx] = hand[idx];
          });
          
          const finalCounts: Record<string, number> = {};
          newHand.forEach(c => finalCounts[c.value] = (finalCounts[c.value] || 0) + 1);
          
          newHand = newHand.map((card) => {
              if (finalCounts[card.value] > 1) {
                  finalCounts[card.value]--;
                  return { ...card, value: card.value === '2' ? '3' : '2' };
              }
              return card;
          });
      }

      setHand(newHand);
      setGameStage('OVER');
      setMessage('Game Over');
  };

  const reset = () => {
      setGameStage('BET');
      setHand([]);
      setMessage('Jacks or Better');
  };

  return (
    <div className="flex flex-col items-center justify-between min-h-[600px] bg-[#003366] rounded-xl p-6 border-4 border-blue-400 relative shadow-2xl">
      <button onClick={onClose} className="absolute top-4 left-4 text-white hover:text-blue-200 font-bold z-10">‹ Exit</button>
      
      <div className="text-center mb-4">
        <h2 className="text-3xl font-bold text-blue-200 italic tracking-tighter">VIDEO POKER</h2>
        <div className="text-blue-300 text-xs">JACKS OR BETTER</div>
      </div>

      {/* Paytable Visual (Static) */}
      <div className="bg-blue-900/50 p-2 rounded text-[10px] text-blue-200 grid grid-cols-2 gap-x-8 mb-4 w-full max-w-lg border border-blue-500/30">
          <div className="flex justify-between"><span>ROYAL FLUSH</span><span className="text-yellow-400">800</span></div>
          <div className="flex justify-between"><span>STRAIGHT FLUSH</span><span className="text-yellow-400">50</span></div>
          <div className="flex justify-between"><span>4 OF A KIND</span><span className="text-yellow-400">25</span></div>
          <div className="flex justify-between"><span>FULL HOUSE</span><span className="text-yellow-400">9</span></div>
          <div className="flex justify-between"><span>FLUSH</span><span className="text-yellow-400">6</span></div>
          <div className="flex justify-between"><span>STRAIGHT</span><span className="text-yellow-400">4</span></div>
          <div className="flex justify-between"><span>3 OF A KIND</span><span className="text-yellow-400">3</span></div>
          <div className="flex justify-between"><span>2 PAIR</span><span className="text-yellow-400">2</span></div>
          <div className="flex justify-between"><span>JACKS OR BETTER</span><span className="text-yellow-400">1</span></div>
      </div>

      {/* Cards Area */}
      <div className="flex justify-center gap-2 h-32 mb-4">
          {hand.length === 0 ? (
              // Empty Placeholders
              Array.from({length:5}).map((_, i) => (
                  <div key={i} className="w-20 h-28 bg-blue-800 rounded border border-blue-600"></div>
              ))
          ) : (
              hand.map((card, idx) => (
                  <div key={idx} className="relative">
                      {/* Card */}
                      <div className="w-20 h-28 bg-white rounded flex flex-col items-center justify-center shadow-lg border-2 border-gray-200">
                          <div className={`text-xl font-bold ${getCardColor(card.suit)}`}>{card.value}</div>
                          <div className={`text-3xl ${getCardColor(card.suit)}`}>{card.suit}</div>
                      </div>
                      
                      {/* Hold Button / Badge */}
                      {gameStage === 'DRAW' && (
                          <button 
                            onClick={() => toggleHold(idx)}
                            className={`absolute -bottom-4 left-1/2 transform -translate-x-1/2 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider shadow-sm transition-colors ${heldIndices.includes(idx) ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                          >
                              {heldIndices.includes(idx) ? 'HELD' : 'HOLD'}
                          </button>
                      )}
                      {gameStage === 'OVER' && heldIndices.includes(idx) && (
                          <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 text-[10px] font-bold px-2 py-1 rounded uppercase bg-gray-600 text-gray-300">
                              HELD
                          </div>
                      )}
                  </div>
              ))
          )}
      </div>

      <div className="text-2xl font-bold text-white h-8 mb-4">{message}</div>

      {/* Controls */}
      <div className="w-full max-w-lg bg-black/30 p-4 rounded-xl border-t border-blue-500/30 flex items-center justify-between">
          <div className="text-white">
               <div className="text-xs text-blue-300">Balance</div>
               <div className="font-bold text-yellow-400">{userBalance.toFixed(2)}</div>
          </div>
          
          {gameStage === 'BET' || gameStage === 'OVER' ? (
              <div className="flex gap-4 items-center">
                  <div className="flex items-center gap-2">
                       <button onClick={() => setStake(Math.max(1, stake - 5))} className="w-8 h-8 bg-blue-800 text-white rounded font-bold">-</button>
                       <span className="text-white font-bold w-8 text-center">{stake}</span>
                       <button onClick={() => setStake(stake + 5)} className="w-8 h-8 bg-blue-800 text-white rounded font-bold">+</button>
                  </div>
                  <button 
                    onClick={gameStage === 'OVER' ? reset : deal}
                    className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-8 py-2 rounded shadow-lg uppercase"
                  >
                      {gameStage === 'OVER' ? 'NEW GAME' : 'DEAL'}
                  </button>
              </div>
          ) : (
              <button 
                onClick={draw}
                className="bg-green-500 hover:bg-green-400 text-white font-bold px-12 py-3 rounded shadow-lg uppercase w-full max-w-xs"
              >
                  DRAW
              </button>
          )}
      </div>
    </div>
  );
};

export default VideoPoker;