import express from 'express';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
router.use(requireAuth);

// --- Shared house rules (kept simple & proportional to a play-money
// simulator, not a full enterprise risk-limits system) ---
const MIN_STAKE = 1;
const MAX_STAKE = 5000;
// The house allows a real win on ~1% of rounds; the other ~99% are forced
// to a loss. Wins are also capped to a small profit (5%-50% of stake)
// instead of each game's "natural" payout table.
const WIN_CHANCE = 0.01;
const smallProfitMultiplier = () => 1.05 + Math.random() * 0.45;

function validateStake(stake) {
  return typeof stake === 'number' && Number.isFinite(stake) && stake >= MIN_STAKE && stake <= MAX_STAKE;
}

// Deducts `stake` from the user's balance inside a transaction, re-checking
// the balance under a row lock to close the race window between two
// concurrent requests from the same user (same pattern as bets.js).
// Returns true on success, false if the balance is insufficient.
async function deductStake(userId, stake) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0] || rows[0].balance < stake) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [stake, userId]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function creditPayout(userId, amount) {
  if (amount > 0) {
    await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, userId]);
  }
}

async function getBalance(userId) {
  const { rows } = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
  return rows[0]?.balance ?? 0;
}

// =====================================================================
// SLOTS — single-shot
// =====================================================================
const SLOT_SYMBOLS = ['🍒', '🍋', '🍇', '💎', '🔔', '7️⃣'];

router.post('/slots/spin', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });

  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  let reels;
  let payout = 0;
  if (Math.random() < WIN_CHANCE) {
    const symbol = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
    reels = [symbol, symbol, symbol];
    payout = Number((stake * smallProfitMultiplier()).toFixed(2));
  } else {
    reels = [0, 1, 2].map(() => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      reels[2] = SLOT_SYMBOLS[(SLOT_SYMBOLS.indexOf(reels[2]) + 1) % SLOT_SYMBOLS.length];
    }
  }

  await creditPayout(req.user.id, payout);
  const balance = await getBalance(req.user.id);
  res.json({ reels, payout, balance });
});

// =====================================================================
// ROULETTE — single-shot
// =====================================================================
const ROULETTE_NUMBERS = Array.from({ length: 37 }, (_, i) => i);
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const ROULETTE_SPOTS = new Set(['RED', 'BLACK', 'EVEN', 'ODD']);

router.post('/roulette/spin', async (req, res) => {
  const { bets } = req.body || {};
  if (!bets || typeof bets !== 'object' || Array.isArray(bets) || Object.keys(bets).length === 0) {
    return res.status(400).json({ error: 'At least one bet is required' });
  }

  let totalBet = 0;
  for (const [spot, amount] of Object.entries(bets)) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: `Invalid bet amount for ${spot}` });
    }
    const num = parseInt(spot, 10);
    const isNumberSpot = !isNaN(num) && String(num) === spot && num >= 0 && num <= 36;
    if (!isNumberSpot && !ROULETTE_SPOTS.has(spot)) {
      return res.status(400).json({ error: `Unknown bet spot: ${spot}` });
    }
    totalBet += amount;
  }
  if (!validateStake(totalBet)) return res.status(400).json({ error: `Total bet must be between ${MIN_STAKE} and ${MAX_STAKE}` });

  const ok = await deductStake(req.user.id, totalBet);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const winningNumbers = new Set();
  Object.keys(bets).forEach((key) => {
    const num = parseInt(key, 10);
    if (!isNaN(num) && String(num) === key) winningNumbers.add(num);
    if (key === 'RED') RED_NUMBERS.forEach((n) => winningNumbers.add(n));
    if (key === 'BLACK') ROULETTE_NUMBERS.forEach((n) => { if (n !== 0 && !RED_NUMBERS.includes(n)) winningNumbers.add(n); });
    if (key === 'EVEN') ROULETTE_NUMBERS.forEach((n) => { if (n !== 0 && n % 2 === 0) winningNumbers.add(n); });
    if (key === 'ODD') ROULETTE_NUMBERS.forEach((n) => { if (n !== 0 && n % 2 !== 0) winningNumbers.add(n); });
  });
  let losingNumbers = ROULETTE_NUMBERS.filter((n) => !winningNumbers.has(n));
  if (losingNumbers.length === 0) losingNumbers = [0];

  const useWinningPool = winningNumbers.size > 0 && Math.random() < WIN_CHANCE;
  const pickPool = useWinningPool ? Array.from(winningNumbers) : losingNumbers;
  const result = pickPool[Math.floor(Math.random() * pickPool.length)];
  const payout = useWinningPool ? Number((totalBet * smallProfitMultiplier()).toFixed(2)) : 0;

  await creditPayout(req.user.id, payout);
  const balance = await getBalance(req.user.id);
  res.json({ result, payout, balance });
});

// =====================================================================
// BACCARAT — single-shot, resolved via rejection sampling so the cards
// shown to the player always add up to the (house-controlled) result.
// =====================================================================
const CARD_SUITS = ['♠', '♥', '♦', '♣'];
const BACCARAT_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const baccaratValue = (v) => (['10', 'J', 'Q', 'K'].includes(v) ? 0 : v === 'A' ? 1 : parseInt(v, 10));
const randBaccaratCard = () => {
  const suit = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
  const value = BACCARAT_VALUES[Math.floor(Math.random() * BACCARAT_VALUES.length)];
  return { suit, value, numValue: baccaratValue(value) };
};
const scoreBaccaratHand = (hand) => hand.reduce((a, c) => a + c.numValue, 0) % 10;

function dealBaccaratRound() {
  const p1 = randBaccaratCard(), b1 = randBaccaratCard(), p2 = randBaccaratCard(), b2 = randBaccaratCard();
  const pHand = [p1, p2], bHand = [b1, b2];
  let pScore = scoreBaccaratHand(pHand), bScore = scoreBaccaratHand(bHand);

  if (pScore >= 8 || bScore >= 8) {
    // Natural — no more cards
  } else {
    let p3 = null;
    if (pScore <= 5) {
      p3 = randBaccaratCard();
      pHand.push(p3);
      pScore = scoreBaccaratHand(pHand);
    }
    let bankerDraws = false;
    if (bScore <= 2) bankerDraws = true;
    else if (bScore === 3) bankerDraws = p3?.numValue !== 8;
    else if (bScore === 4) bankerDraws = p3 === null || [2, 3, 4, 5, 6, 7].includes(p3.numValue);
    else if (bScore === 5) bankerDraws = p3 === null || [4, 5, 6, 7].includes(p3.numValue);
    else if (bScore === 6) bankerDraws = p3 !== null && [6, 7].includes(p3.numValue);
    if (bankerDraws) {
      const b3 = randBaccaratCard();
      bHand.push(b3);
      bScore = scoreBaccaratHand(bHand);
    }
  }

  let result;
  if (pScore > bScore) result = 'PLAYER';
  else if (bScore > pScore) result = 'BANKER';
  else result = 'TIE';
  return { pHand, bHand, result };
}

router.post('/baccarat/deal', async (req, res) => {
  const { stake, selectedBet } = req.body || {};
  if (!['PLAYER', 'BANKER', 'TIE'].includes(selectedBet)) return res.status(400).json({ error: 'Invalid bet selection' });
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });

  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const wantWin = Math.random() < WIN_CHANCE;
  let round = dealBaccaratRound();
  let attempts = 0;
  while (attempts < 300 && (wantWin ? round.result !== selectedBet : round.result === selectedBet)) {
    round = dealBaccaratRound();
    attempts++;
  }

  const payout = round.result === selectedBet ? Number((stake * smallProfitMultiplier()).toFixed(2)) : 0;
  await creditPayout(req.user.id, payout);
  const balance = await getBalance(req.user.id);
  res.json({ playerHand: round.pHand, bankerHand: round.bHand, result: round.result, payout, balance });
});

// =====================================================================
// CRASH — round starts with a hidden, server-committed crash point;
// cashing out is checked against server-elapsed time, not client claims.
// =====================================================================
router.post('/crash/start', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });

  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  // ~1% of rounds get a real, reachable crash point (a small win if cashed
  // out in time); the other ~99% crash instantly at 1.00x.
  const crashPoint = Math.random() < WIN_CHANCE ? 1.05 + Math.random() * 0.45 : 1.0;
  const roundId = randomUUID();
  const startTime = Date.now();

  await pool.query(
    `INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at)
     VALUES ($1,$2,'crash',$3,'PENDING',$4,$5)`,
    [roundId, req.user.id, stake, JSON.stringify({ crashPoint, startTime }), startTime]
  );
  const balance = await getBalance(req.user.id);
  res.json({ roundId, startTime, balance });
});

// Read-only poll: tells the client whether the round has crashed yet
// (server-elapsed-time authoritative), without resolving/crediting anything.
// If it has crashed and the round is still PENDING, marks it RESOLVED with
// a 0 payout — a crashed round that was never cashed out is a loss.
router.get('/crash/:id/status', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
  const round = rows[0];
  if (!round || round.game !== 'crash') return res.status(404).json({ error: 'Round not found' });
  if (round.user_id !== req.user.id) return res.status(403).json({ error: 'Not your round' });

  if (round.status !== 'PENDING') {
    const result = round.result ? JSON.parse(round.result) : {};
    return res.json({ crashed: !!result.crashed, multiplier: result.cashoutMultiplier ?? null, resolved: true });
  }

  const state = JSON.parse(round.state);
  const elapsedSeconds = (Date.now() - state.startTime) / 1000;
  const currentMultiplier = Math.floor(Math.exp(0.15 * elapsedSeconds) * 100) / 100;
  const crashed = currentMultiplier >= state.crashPoint;

  if (crashed) {
    await pool.query(
      'UPDATE casino_rounds SET status = $1, payout = 0, resolved_at = $2, result = $3 WHERE id = $4',
      ['RESOLVED', Date.now(), JSON.stringify({ crashed: true, cashoutMultiplier: state.crashPoint }), round.id]
    );
    return res.json({ crashed: true, multiplier: state.crashPoint, resolved: true });
  }

  res.json({ crashed: false, multiplier: currentMultiplier, resolved: false });
});

router.post('/crash/:id/cashout', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
  const round = rows[0];
  if (!round || round.game !== 'crash') return res.status(404).json({ error: 'Round not found' });
  if (round.user_id !== req.user.id) return res.status(403).json({ error: 'Not your round' });
  if (round.status !== 'PENDING') return res.status(400).json({ error: 'Round already resolved' });

  const state = JSON.parse(round.state);
  const elapsedSeconds = (Date.now() - state.startTime) / 1000;
  const currentMultiplier = Math.floor(Math.exp(0.15 * elapsedSeconds) * 100) / 100;

  const crashed = currentMultiplier >= state.crashPoint;
  const payout = crashed ? 0 : Number((round.stake * currentMultiplier).toFixed(2));

  await pool.query(
    'UPDATE casino_rounds SET status = $1, payout = $2, resolved_at = $3, result = $4 WHERE id = $5',
    ['RESOLVED', payout, Date.now(), JSON.stringify({ crashed, cashoutMultiplier: currentMultiplier }), round.id]
  );
  await creditPayout(req.user.id, payout);
  const balance = await getBalance(req.user.id);
  res.json({ crashed, multiplier: currentMultiplier, payout, balance });
});

// =====================================================================
// BLACKJACK — multi-step (deal / hit / stand), state kept server-side
// =====================================================================
const BJ_VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function buildShuffledDeck() {
  const deck = [];
  for (const suit of CARD_SUITS) {
    for (const val of BJ_VALUES) {
      let num = parseInt(val, 10);
      if (['J', 'Q', 'K'].includes(val)) num = 10;
      if (val === 'A') num = 11;
      deck.push({ suit, value: val, numValue: num });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}
function calcBjScore(hand) {
  let score = hand.reduce((a, c) => a + c.numValue, 0);
  let aces = hand.filter((c) => c.value === 'A').length;
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}
// A genuine player win only pays out ~1% of the time (capped to a small
// profit); pushes return the stake; losses return nothing.
function resolveBlackjackResult(stake, natural) {
  if (natural.kind === 'LOSS') return { payout: 0, message: natural.message };
  if (natural.kind === 'PUSH') return { payout: stake, message: natural.message };
  if (Math.random() < WIN_CHANCE) {
    return { payout: Number((stake * smallProfitMultiplier()).toFixed(2)), message: natural.message };
  }
  return { payout: 0, message: 'DEALER WINS' };
}

router.post('/blackjack/deal', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });

  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const deck = buildShuffledDeck();
  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop(), deck.pop()];
  const roundId = randomUUID();
  const now = Date.now();

  let status = 'PLAYING';
  let payout = 0;
  let message = null;

  if (calcBjScore(playerHand) === 21) {
    const dealerBJ = calcBjScore(dealerHand) === 21;
    const natural = dealerBJ ? { kind: 'PUSH', message: 'PUSH' } : { kind: 'WIN', message: 'BLACKJACK' };
    const outcome = resolveBlackjackResult(stake, natural);
    payout = outcome.payout;
    message = outcome.message;
    status = 'FINISHED';
    await creditPayout(req.user.id, payout);
  }

  await pool.query(
    `INSERT INTO casino_rounds (id, user_id, game, stake, status, state, payout, result, created_at, resolved_at)
     VALUES ($1,$2,'blackjack',$3,$4,$5,$6,$7,$8,$9)`,
    [roundId, req.user.id, stake, status, JSON.stringify({ deck, playerHand, dealerHand }), payout,
      message ? JSON.stringify({ message }) : null, now, status === 'FINISHED' ? now : null]
  );

  const balance = await getBalance(req.user.id);
  res.json({
    roundId,
    status,
    playerHand,
    dealerHand: status === 'PLAYING' ? [dealerHand[0], null] : dealerHand,
    message,
    payout,
    balance,
  });
});

router.post('/blackjack/:id/hit', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
  const round = rows[0];
  if (!round || round.game !== 'blackjack') return res.status(404).json({ error: 'Round not found' });
  if (round.user_id !== req.user.id) return res.status(403).json({ error: 'Not your round' });
  if (round.status !== 'PLAYING') return res.status(400).json({ error: 'Round already finished' });

  const state = JSON.parse(round.state);
  state.playerHand.push(state.deck.pop());
  const score = calcBjScore(state.playerHand);

  if (score > 21) {
    const outcome = resolveBlackjackResult(round.stake, { kind: 'LOSS', message: 'BUST' });
    await pool.query(
      'UPDATE casino_rounds SET status = $1, state = $2, payout = $3, result = $4, resolved_at = $5 WHERE id = $6',
      ['FINISHED', JSON.stringify(state), outcome.payout, JSON.stringify({ message: outcome.message }), Date.now(), round.id]
    );
    await creditPayout(req.user.id, outcome.payout);
    const balance = await getBalance(req.user.id);
    return res.json({ status: 'FINISHED', playerHand: state.playerHand, dealerHand: state.dealerHand, message: outcome.message, payout: outcome.payout, balance });
  }

  await pool.query('UPDATE casino_rounds SET state = $1 WHERE id = $2', [JSON.stringify(state), round.id]);
  res.json({ status: 'PLAYING', playerHand: state.playerHand, dealerHand: [state.dealerHand[0], null] });
});

router.post('/blackjack/:id/stand', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
  const round = rows[0];
  if (!round || round.game !== 'blackjack') return res.status(404).json({ error: 'Round not found' });
  if (round.user_id !== req.user.id) return res.status(403).json({ error: 'Not your round' });
  if (round.status !== 'PLAYING') return res.status(400).json({ error: 'Round already finished' });

  const state = JSON.parse(round.state);
  while (calcBjScore(state.dealerHand) < 17) {
    state.dealerHand.push(state.deck.pop());
  }
  const pScore = calcBjScore(state.playerHand);
  const dScore = calcBjScore(state.dealerHand);

  let natural;
  if (dScore > 21) natural = { kind: 'WIN', message: 'DEALER BUST' };
  else if (pScore > dScore) natural = { kind: 'WIN', message: 'YOU WIN' };
  else if (pScore === dScore) natural = { kind: 'PUSH', message: 'PUSH' };
  else natural = { kind: 'LOSS', message: 'DEALER WINS' };

  const outcome = resolveBlackjackResult(round.stake, natural);
  await pool.query(
    'UPDATE casino_rounds SET status = $1, state = $2, payout = $3, result = $4, resolved_at = $5 WHERE id = $6',
    ['FINISHED', JSON.stringify(state), outcome.payout, JSON.stringify({ message: outcome.message }), Date.now(), round.id]
  );
  await creditPayout(req.user.id, outcome.payout);
  const balance = await getBalance(req.user.id);
  res.json({ status: 'FINISHED', playerHand: state.playerHand, dealerHand: state.dealerHand, message: outcome.message, payout: outcome.payout, balance });
});

// =====================================================================
// VIDEO POKER — multi-step (deal / draw), state kept server-side
// =====================================================================
const randomPokerCard = () => ({
  suit: CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)],
  value: BJ_VALUES[Math.floor(Math.random() * BJ_VALUES.length)],
});
const shuffleArr = (arr) => [...arr].sort(() => Math.random() - 0.5);
const mkPokerCard = (suit, value) => ({ suit, value });

const buildJacksOrBetter = () => {
  const rank = ['J', 'Q', 'K', 'A'][Math.floor(Math.random() * 4)];
  const pair = shuffleArr(CARD_SUITS).slice(0, 2).map((s) => mkPokerCard(s, rank));
  const fillers = shuffleArr(BJ_VALUES.filter((v) => v !== rank)).slice(0, 3)
    .map((v) => mkPokerCard(CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)], v));
  return shuffleArr([...pair, ...fillers]);
};
const buildTwoPair = () => {
  const [rankA, rankB] = shuffleArr(BJ_VALUES).slice(0, 2);
  const pairA = shuffleArr(CARD_SUITS).slice(0, 2).map((s) => mkPokerCard(s, rankA));
  const pairB = shuffleArr(CARD_SUITS).slice(0, 2).map((s) => mkPokerCard(s, rankB));
  const filler = shuffleArr(BJ_VALUES.filter((v) => v !== rankA && v !== rankB))[0];
  return shuffleArr([...pairA, ...pairB, mkPokerCard(CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)], filler)]);
};
const buildThreeOfAKind = () => {
  const rank = BJ_VALUES[Math.floor(Math.random() * BJ_VALUES.length)];
  const trips = shuffleArr(CARD_SUITS).slice(0, 3).map((s) => mkPokerCard(s, rank));
  const fillers = shuffleArr(BJ_VALUES.filter((v) => v !== rank)).slice(0, 2)
    .map((v) => mkPokerCard(CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)], v));
  return shuffleArr([...trips, ...fillers]);
};
const buildFullHouse = () => {
  const [rankA, rankB] = shuffleArr(BJ_VALUES).slice(0, 2);
  const trips = shuffleArr(CARD_SUITS).slice(0, 3).map((s) => mkPokerCard(s, rankA));
  const pair = shuffleArr(CARD_SUITS).slice(0, 2).map((s) => mkPokerCard(s, rankB));
  return shuffleArr([...trips, ...pair]);
};
const buildFourOfAKind = () => {
  const rank = BJ_VALUES[Math.floor(Math.random() * BJ_VALUES.length)];
  const quads = CARD_SUITS.map((s) => mkPokerCard(s, rank));
  const filler = shuffleArr(BJ_VALUES.filter((v) => v !== rank))[0];
  return shuffleArr([...quads, mkPokerCard(CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)], filler)]);
};
const pickConsecutiveRun = (excludeRoyal) => {
  const maxStart = BJ_VALUES.length - 5;
  const start = excludeRoyal ? Math.floor(Math.random() * maxStart) : maxStart;
  return BJ_VALUES.slice(start, start + 5);
};
const buildStraight = () => {
  const ranks = pickConsecutiveRun(true);
  const suits = ranks.map(() => CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)]);
  if (suits.every((s) => s === suits[0])) suits[4] = CARD_SUITS[(CARD_SUITS.indexOf(suits[4]) + 1) % CARD_SUITS.length];
  return shuffleArr(ranks.map((v, i) => mkPokerCard(suits[i], v)));
};
const buildFlush = () => {
  const suit = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
  const ranks = shuffleArr(BJ_VALUES).slice(0, 5);
  const indices = ranks.map((v) => BJ_VALUES.indexOf(v)).sort((a, b) => a - b);
  const isConsecutive = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
  if (isConsecutive) ranks[0] = BJ_VALUES.find((v) => !ranks.includes(v));
  return shuffleArr(ranks.map((v) => mkPokerCard(suit, v)));
};
const buildStraightFlush = () => {
  const suit = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
  return shuffleArr(pickConsecutiveRun(true).map((v) => mkPokerCard(suit, v)));
};
const buildRoyalFlush = () => {
  const suit = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
  return shuffleArr(pickConsecutiveRun(false).map((v) => mkPokerCard(suit, v)));
};
const VP_WIN_TIERS = [
  { name: 'ROYAL FLUSH', weight: 1, build: buildRoyalFlush },
  { name: 'STRAIGHT FLUSH', weight: 3, build: buildStraightFlush },
  { name: '4 OF A KIND', weight: 6, build: buildFourOfAKind },
  { name: 'FULL HOUSE', weight: 10, build: buildFullHouse },
  { name: 'FLUSH', weight: 12, build: buildFlush },
  { name: 'STRAIGHT', weight: 12, build: buildStraight },
  { name: '3 OF A KIND', weight: 20, build: buildThreeOfAKind },
  { name: '2 PAIR', weight: 16, build: buildTwoPair },
  { name: 'JACKS OR BETTER', weight: 20, build: buildJacksOrBetter },
];
function pickWeightedTier() {
  const totalWeight = VP_WIN_TIERS.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * totalWeight;
  for (const tier of VP_WIN_TIERS) {
    if (r < tier.weight) return tier;
    r -= tier.weight;
  }
  return VP_WIN_TIERS[VP_WIN_TIERS.length - 1];
}

router.post('/videopoker/deal', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });

  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const hand = Array.from({ length: 5 }, randomPokerCard);
  const roundId = randomUUID();
  await pool.query(
    `INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at)
     VALUES ($1,$2,'videopoker',$3,'PLAYING',$4,$5)`,
    [roundId, req.user.id, stake, JSON.stringify({ hand }), Date.now()]
  );
  const balance = await getBalance(req.user.id);
  res.json({ roundId, hand, balance });
});

router.post('/videopoker/:id/draw', async (req, res) => {
  const { holdIndices } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
  const round = rows[0];
  if (!round || round.game !== 'videopoker') return res.status(404).json({ error: 'Round not found' });
  if (round.user_id !== req.user.id) return res.status(403).json({ error: 'Not your round' });
  if (round.status !== 'PLAYING') return res.status(400).json({ error: 'Round already finished' });

  const held = Array.isArray(holdIndices) ? holdIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < 5) : [];
  const state = JSON.parse(round.state);

  let payout = 0;
  let tierName = null;
  let finalHand;

  if (Math.random() < WIN_CHANCE) {
    const tier = pickWeightedTier();
    finalHand = tier.build();
    payout = Number((round.stake * smallProfitMultiplier()).toFixed(2));
    tierName = tier.name;
  } else {
    let newHand = state.hand.map((card, idx) => (held.includes(idx) ? card : randomPokerCard()));
    const counts = {};
    newHand.forEach((c) => { counts[c.value] = (counts[c.value] || 0) + 1; });
    const winningValues = ['J', 'Q', 'K', 'A'];
    const hasWinningPair = winningValues.some((v) => counts[v] >= 2);
    if (hasWinningPair || Object.values(counts).some((c) => c >= 2)) {
      newHand = [
        { suit: '♠', value: '2' }, { suit: '♥', value: '4' }, { suit: '♣', value: '7' },
        { suit: '♦', value: '9' }, { suit: '♠', value: 'Q' },
      ];
      held.forEach((idx) => { newHand[idx] = state.hand[idx]; });
      const finalCounts = {};
      newHand.forEach((c) => { finalCounts[c.value] = (finalCounts[c.value] || 0) + 1; });
      newHand = newHand.map((card) => {
        if (finalCounts[card.value] > 1) {
          finalCounts[card.value]--;
          return { ...card, value: card.value === '2' ? '3' : '2' };
        }
        return card;
      });
    }
    finalHand = newHand;
  }

  await pool.query(
    'UPDATE casino_rounds SET status = $1, state = $2, payout = $3, result = $4, resolved_at = $5 WHERE id = $6',
    ['FINISHED', JSON.stringify({ hand: finalHand }), payout, JSON.stringify({ tier: tierName }), Date.now(), round.id]
  );
  await creditPayout(req.user.id, payout);
  const balance = await getBalance(req.user.id);
  res.json({ hand: finalHand, tier: tierName, payout, balance });
});

export default router;
