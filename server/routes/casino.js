import express from 'express';
import { randomUUID, randomInt } from 'crypto';
import pool from '../db.js';
import { requireAuth } from './auth.js';
import { getCasinoAccess, canOpenCasino, getDisabledGames, gameKeyForPath } from '../casinoAccess.js';
import { PLINKO_ROWS, PLINKO_RISKS, plinkoMultipliers, minesMultiplier, MINES_TILES, dragonTigerPayout, DT_PAYOUT } from '../casinoMath.js';
import { isSuperAdmin } from '../roles.js';
import { WHEEL_SEGMENTS, wheelSpin } from '../wheel.js';
import { KENO_PAYTABLE, KENO_POOL, KENO_MAX_PICKS, drawKeno, kenoResult } from '../keno.js';
import { scratchCard } from '../scratch.js';
import * as tumbleEngine from '../slots/tumble.js';
import * as crashEngine from '../crash.js';
import * as hiloEngine from '../hilo.js';
import * as holdWinEngine from '../holdwin.js';
import { normalizeCurrency, walletColumn, accountCurrencyOf, allowsCurrency, accountCurrencyError } from '../ledger.js';
import { SLOT_GAMES as VIDEO_SLOTS, getSlotGame as getVideoSlot, publicGame } from '../slots/games.js';
import { playRound } from '../slots/engine.js';
import {
  GAMES as SLOT_GAMES, getGame as getSlotGame, spinReels as spinSlotReels,
  multiplierFor as slotMultiplier, payoutFor as slotPayout, describeGame as describeSlotGame,
} from '../slots.js';

const router = express.Router();
router.use(requireAuth);
// Who may open the casino is a switch of the super admin (casino_access): off / only the super admin / everybody.
router.get('/access', async (req, res) => {
  const mode = await getCasinoAccess();
  res.json({ mode, allowed: canOpenCasino(mode, req.user.role), disabledGames: await getDisabledGames() });
});
router.use(async (req, res, next) => {
  const mode = await getCasinoAccess();
  if (canOpenCasino(mode, req.user.role)) return next();
  return res.status(403).json({ error: 'Casino is not available' });
});
// A single game can be closed by the super admin; the super admin himself can still open it.
router.use(async (req, res, next) => {
  const game = gameKeyForPath(req.path);
  if (game && !isSuperAdmin(req.user.role) && (await getDisabledGames()).includes(game)) {
    return res.status(403).json({ error: 'This game is not available right now', code: 'GAME_DISABLED' });
  }
  return next();
});

// --- Shared house rules (kept simple & proportional to a play-money
// simulator, not a full enterprise risk-limits system) ---
const MIN_STAKE = 1;
const MAX_STAKE = 5000;
// Fair play: every round is decided by the real draw (shuffled cards, real wheel, real dice) and pays the
// standard table below. The house edge comes only from those payout tables, never from forcing outcomes.
export const PAYOUT = {
  ROULETTE_NUMBER: 36, // 35:1 + stake
  ROULETTE_EVEN_MONEY: 2,
  BACCARAT: { PLAYER: 2, BANKER: 1.95, TIE: 9 }, // tie returns P/B stakes
  BLACKJACK: 2.5,
  WIN: 2,
  DICE: { UNDER: 2.28, SEVEN: 5.7, OVER: 2.28 },
};
export const roundMoney = (n) => Number(n.toFixed(2));

export function validateStake(stake) {
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
// SLOT GAMES — 5x3 video slots, 10 lines, wild, scatter, free spins (see server/slots/)
// The result is drawn on the server with the crypto RNG; the browser only shows it. Each game shows its real
// RTP (~95%). The super admin plays in demo mode: nothing is debited or credited.
// =====================================================================
export const SLOT_STAKES = {
  ALL: [10, 20, 50, 100, 200, 500, 1000, 2000, 5000],
  EUR: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50],
};
export const SLOT_LIMITS = { ALL: { min: 10, max: 5000 }, EUR: { min: 0.1, max: 50 } };
// Players type any stake they like (max 2 decimals) inside the currency's limits; the preset chips are only shortcuts.
export function validSlotStake(currency, stake) {
  const lim = SLOT_LIMITS[currency];
  return !!lim && typeof stake === 'number' && Number.isFinite(stake) && Math.round(stake * 100) / 100 === stake && stake >= lim.min && stake <= lim.max;
}
const MAX_WIN_MULTIPLIER = 2000; // one round never pays more than 2000x the stake
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

router.get('/slot-games', (req, res) => {
  res.json({ games: VIDEO_SLOTS.map(publicGame), stakes: SLOT_STAKES, limits: SLOT_LIMITS, demo: isSuperAdmin(req.user.role) });
});

// Shared by every slot-like game: super admin plays a demo round, everybody else is debited / credited in one transaction.
// `draw()` returns { payout, freeSpins, ...whatever the client animates }.
async function runSlotRound(req, res, gameId, stake, currency, draw) {
  // Super admin: demo round, no wallet involved.
  if (isSuperAdmin(req.user.role)) return res.json({ ...draw(), demo: true });

  const col = walletColumn(currency);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT ${col} AS bal FROM users WHERE id = $1 FOR UPDATE`, [req.user.id]);
    if (!rows[0] || Number(rows[0].bal) < stake) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    const round = draw();
    await client.query(`UPDATE users SET ${col} = ${col} - $1 + $2 WHERE id = $3`, [stake, round.payout, req.user.id]);
    await client.query(
      `INSERT INTO casino_rounds (id, user_id, game, currency, stake, payout, free_spins, status, created_at, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'FINISHED',$8,$8)`,
      [randomUUID(), req.user.id, gameId, currency, stake, round.payout, round.freeSpins, Date.now()]
    );
    const { rows: bal } = await client.query('SELECT balance, balance_eur FROM users WHERE id = $1', [req.user.id]);
    await client.query('COMMIT');
    res.json({ ...round, demo: false, balance: Number(bal[0].balance), balanceEur: Number(bal[0].balance_eur) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

router.post('/slot-games/:id/spin', async (req, res) => {
  const game = getVideoSlot(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const acct = await accountCurrencyOf(req.user.id);
  const currency = req.body?.currency === undefined && acct === 'EUR' ? 'EUR' : normalizeCurrency(req.body?.currency);
  if (!allowsCurrency(acct, currency)) return res.status(400).json({ error: accountCurrencyError(acct) });
  const stake = req.body?.stake;
  if (!validSlotStake(currency, stake)) return res.status(400).json({ error: 'Invalid stake' });

  const draw = () => {
    const r = playRound(game, (n) => randomInt(n));
    const multiplier = Math.min(r.totalMultiplier, MAX_WIN_MULTIPLIER);
    return {
      spins: r.spins.map((sp) => ({ grid: sp.grid, wins: sp.wins, scatters: sp.scatters, free: sp.free, win: round2(sp.win * stake) })),
      payout: round2(multiplier * stake),
      freeSpins: r.spins.length - 1,
    };
  };

  return runSlotRound(req, res, game.id, stake, currency, draw);
});

// =====================================================================
// SLOTS — single-shot, fair RNG (see server/slots.js). One transaction: lock the player's row, check the
// balance, apply stake - payout and write the round, so a crash can never leave a debited stake with no result.
// =====================================================================
router.get('/slots/games', (req, res) => {
  res.json({ games: Object.values(SLOT_GAMES).map(describeSlotGame) });
});

router.post('/slots/spin', async (req, res) => {
  const { stake, game: gameId } = req.body || {};
  if (!validateStake(stake) || Math.round(stake * 100) / 100 !== stake) {
    return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE} (max 2 decimals)` });
  }
  const game = getSlotGame(gameId);
  if (!game) return res.status(400).json({ error: 'Unknown slot game' });

  const reels = spinSlotReels(game);
  const multiplier = slotMultiplier(game, reels);
  const payout = slotPayout(stake, multiplier);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (!rows[0] || Number(rows[0].balance) < stake) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    const now = Date.now();
    const { rows: updated } = await client.query(
      'UPDATE users SET balance = balance - $1 + $2 WHERE id = $3 RETURNING balance',
      [stake, payout, req.user.id]
    );
    await client.query(
      `INSERT INTO casino_rounds (id, user_id, game, stake, status, state, payout, result, created_at, resolved_at)
       VALUES ($1,$2,$3,$4,'FINISHED',$5,$6,$7,$8,$8)`,
      [randomUUID(), req.user.id, `slots:${game.id}`, stake, JSON.stringify({ reels }), payout, JSON.stringify({ multiplier }), now]
    );
    await client.query('COMMIT');
    res.json({ game: game.id, reels, multiplier, payout, balance: Number(updated[0].balance) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

  const result = ROULETTE_NUMBERS[randomInt(0, ROULETTE_NUMBERS.length)];
  const inSpot = (spot) => {
    const num = parseInt(spot, 10);
    if (!isNaN(num) && String(num) === spot) return num === result;
    if (result === 0) return false;
    if (spot === 'RED') return RED_NUMBERS.includes(result);
    if (spot === 'BLACK') return !RED_NUMBERS.includes(result);
    if (spot === 'EVEN') return result % 2 === 0;
    return result % 2 !== 0; // ODD
  };
  let payout = 0;
  for (const [spot, amount] of Object.entries(bets)) {
    if (!inSpot(spot)) continue;
    const isNumber = String(parseInt(spot, 10)) === spot;
    payout += amount * (isNumber ? PAYOUT.ROULETTE_NUMBER : PAYOUT.ROULETTE_EVEN_MONEY);
  }
  payout = roundMoney(payout);

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
export const scoreBaccaratHand = (hand) => hand.reduce((a, c) => a + c.numValue, 0) % 10;

export function dealBaccaratRound() {
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

  const round = dealBaccaratRound();
  let payout = 0;
  if (round.result === selectedBet) payout = roundMoney(stake * PAYOUT.BACCARAT[selectedBet]);
  else if (round.result === 'TIE') payout = stake; // tie: bets on PLAYER/BANKER are returned
  await creditPayout(req.user.id, payout);
  const balance = await getBalance(req.user.id);
  res.json({ playerHand: round.pHand, bankerHand: round.bHand, result: round.result, payout, balance });
});

// =====================================================================
// BLACKJACK — multi-step (deal / hit / stand), state kept server-side
// =====================================================================
const BJ_VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export function buildShuffledDeck() {
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
export function calcBjScore(hand) {
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
export function resolveBlackjackResult(stake, natural) {
  if (natural.kind === 'LOSS') return { payout: 0, message: natural.message };
  if (natural.kind === 'PUSH') return { payout: stake, message: natural.message };
  const mult = natural.message === 'BLACKJACK' ? PAYOUT.BLACKJACK : PAYOUT.WIN;
  return { payout: roundMoney(stake * mult), message: natural.message };
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
const mkPokerCard = (suit, value) => ({ suit, value });
const newPokerDeck = () => {
  const deck = [];
  for (const suit of CARD_SUITS) for (const v of BJ_VALUES) deck.push(mkPokerCard(suit, v));
  for (let i = deck.length - 1; i > 0; i -= 1) { const j = randomInt(0, i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
};
// Jacks or Better 9/6 pay table (x stake).
export const VP_PAYS = { 'ROYAL FLUSH': 800, 'STRAIGHT FLUSH': 50, '4 OF A KIND': 25, 'FULL HOUSE': 9, FLUSH: 6, STRAIGHT: 4, '3 OF A KIND': 3, '2 PAIR': 2, 'JACKS OR BETTER': 1 };
export function evaluatePokerHand(hand) {
  const rank = (v) => BJ_VALUES.indexOf(v) + 2; // 2..14 (A high)
  const ranks = hand.map((c) => rank(c.value)).sort((x, y) => x - y);
  const flush = hand.every((c) => c.suit === hand[0].suit);
  const unique = new Set(ranks).size === 5;
  const straight = unique && (ranks[4] - ranks[0] === 4 || ranks.join() === '2,3,4,5,14');
  const counts = {};
  ranks.forEach((r) => { counts[r] = (counts[r] || 0) + 1; });
  const groups = Object.entries(counts).map(([r, n]) => [Number(r), n]).sort((x, y) => y[1] - x[1] || y[0] - x[0]);
  if (straight && flush) return ranks[0] === 10 ? 'ROYAL FLUSH' : 'STRAIGHT FLUSH';
  if (groups[0][1] === 4) return '4 OF A KIND';
  if (groups[0][1] === 3 && groups[1][1] === 2) return 'FULL HOUSE';
  if (flush) return 'FLUSH';
  if (straight) return 'STRAIGHT';
  if (groups[0][1] === 3) return '3 OF A KIND';
  if (groups[0][1] === 2 && groups[1][1] === 2) return '2 PAIR';
  if (groups[0][1] === 2 && groups[0][0] >= 11) return 'JACKS OR BETTER';
  return null;
}

router.post('/videopoker/deal', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });

  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const deck = newPokerDeck();
  const hand = deck.splice(0, 5);
  const roundId = randomUUID();
  await pool.query(
    `INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at)
     VALUES ($1,$2,'videopoker',$3,'PLAYING',$4,$5)`,
    [roundId, req.user.id, stake, JSON.stringify({ hand, deck }), Date.now()]
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

  const deck = Array.isArray(state.deck) ? [...state.deck] : newPokerDeck();
  const finalHand = state.hand.map((card, idx) => (held.includes(idx) ? card : deck.shift()));
  const tierName = evaluatePokerHand(finalHand);
  const payout = tierName ? roundMoney(round.stake * VP_PAYS[tierName]) : 0;

  await pool.query(
    'UPDATE casino_rounds SET status = $1, state = $2, payout = $3, result = $4, resolved_at = $5 WHERE id = $6',
    ['FINISHED', JSON.stringify({ hand: finalHand }), payout, JSON.stringify({ tier: tierName }), Date.now(), round.id]
  );
  await creditPayout(req.user.id, payout);
  const balance = await getBalance(req.user.id);
  res.json({ hand: finalHand, tier: tierName, payout, balance });
});

// =====================================================================
// DICE — two dice, bet on the sum: UNDER (2-6), SEVEN, OVER (8-12). Fair dice, pays the PAYOUT.DICE table.
// =====================================================================
export const DICE_BETS = ['UNDER', 'SEVEN', 'OVER'];
export const diceOutcome = (a, b) => { const sum = a + b; return sum < 7 ? 'UNDER' : sum > 7 ? 'OVER' : 'SEVEN'; };
const rollDie = () => randomInt(1, 7);

router.post('/dice/roll', async (req, res) => {
  const { stake, selectedBet } = req.body || {};
  if (!DICE_BETS.includes(selectedBet)) return res.status(400).json({ error: 'Invalid bet selection' });
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });

  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const dice = [rollDie(), rollDie()];
  const result = diceOutcome(dice[0], dice[1]);
  const payout = result === selectedBet ? roundMoney(stake * PAYOUT.DICE[selectedBet]) : 0;
  await creditPayout(req.user.id, payout);
  const balance = await getBalance(req.user.id);
  res.json({ dice, sum: dice[0] + dice[1], result, payout, balance });
});

// =====================================================================
// PLINKO / MINES / DRAGON TIGER — fair games, crypto RNG, payout tables in server/casinoMath.js
// =====================================================================
async function logRound(userId, game, stake, payout, extra = {}) {
  try {
    const now = Date.now();
    await pool.query(
      `INSERT INTO casino_rounds (id, user_id, game, stake, status, state, result, payout, created_at, resolved_at)
       VALUES ($1,$2,$3,$4,'FINISHED',NULL,$5,$6,$7,$7)`,
      [randomUUID(), userId, game, stake, JSON.stringify(extra), payout, now]
    );
  } catch (err) { console.error('[casino] logRound', err.message); }
}

router.get('/plinko/config', (req, res) => {
  const tables = {};
  for (const rows of PLINKO_ROWS) for (const risk of PLINKO_RISKS) tables[`${rows}-${risk}`] = plinkoMultipliers(rows, risk);
  res.json({ rows: PLINKO_ROWS, risks: PLINKO_RISKS, tables });
});

router.post('/plinko/drop', async (req, res) => {
  const { stake, risk, rows } = req.body || {};
  if (!PLINKO_RISKS.includes(risk) || !PLINKO_ROWS.includes(rows)) return res.status(400).json({ error: 'Invalid risk or rows' });
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const path = Array.from({ length: rows }, () => randomInt(0, 2)); // 1 = right
  const bucket = path.reduce((a, b) => a + b, 0);
  const multiplier = plinkoMultipliers(rows, risk)[bucket];
  const payout = roundMoney(stake * multiplier);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'plinko', stake, payout, { rows, risk, bucket, multiplier });
  res.json({ path, bucket, multiplier, payout, balance: await getBalance(req.user.id) });
});

// MINES — multi-step; the mine positions stay on the server until the round ends.
router.post('/mines/start', async (req, res) => {
  const { stake, mines } = req.body || {};
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) return res.status(400).json({ error: 'Mines must be between 1 and 24' });
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const tiles = Array.from({ length: MINES_TILES }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i -= 1) { const j = randomInt(0, i + 1); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
  const mineSet = tiles.slice(0, mines);
  const roundId = randomUUID();
  await pool.query(
    `INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at)
     VALUES ($1,$2,'mines',$3,'PLAYING',$4,$5)`,
    [roundId, req.user.id, stake, JSON.stringify({ mines: mineSet, revealed: [] }), Date.now()]
  );
  res.json({ roundId, mines, multiplier: 1, nextMultiplier: minesMultiplier(mines, 1), balance: await getBalance(req.user.id) });
});

async function loadMinesRound(req, res) {
  const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
  const round = rows[0];
  if (!round || round.game !== 'mines') { res.status(404).json({ error: 'Round not found' }); return null; }
  if (round.user_id !== req.user.id) { res.status(403).json({ error: 'Not your round' }); return null; }
  if (round.status !== 'PLAYING') { res.status(400).json({ error: 'Round already finished' }); return null; }
  return { round, state: JSON.parse(round.state) };
}

router.post('/mines/:id/reveal', async (req, res) => {
  const { index } = req.body || {};
  if (!Number.isInteger(index) || index < 0 || index >= MINES_TILES) return res.status(400).json({ error: 'Invalid tile' });
  const loaded = await loadMinesRound(req, res);
  if (!loaded) return;
  const { round, state } = loaded;
  if (state.revealed.includes(index)) return res.status(400).json({ error: 'Tile already open' });

  if (state.mines.includes(index)) {
    await pool.query(
      `UPDATE casino_rounds SET status='FINISHED', payout=0, result=$1, resolved_at=$2 WHERE id=$3 AND status='PLAYING'`,
      [JSON.stringify({ hit: index }), Date.now(), round.id]
    );
    return res.json({ safe: false, mines: state.mines, payout: 0, balance: await getBalance(req.user.id) });
  }
  state.revealed.push(index);
  const mineCount = state.mines.length;
  const multiplier = minesMultiplier(mineCount, state.revealed.length);
  const lastTile = state.revealed.length === MINES_TILES - mineCount;
  if (lastTile) {
    const payout = roundMoney(Number(round.stake) * multiplier);
    await pool.query(`UPDATE casino_rounds SET status='FINISHED', state=$1, payout=$2, result=$3, resolved_at=$4 WHERE id=$5 AND status='PLAYING'`,
      [JSON.stringify(state), payout, JSON.stringify({ cleared: true, multiplier }), Date.now(), round.id]);
    await creditPayout(req.user.id, payout);
    return res.json({ safe: true, finished: true, multiplier, payout, mines: state.mines, balance: await getBalance(req.user.id) });
  }
  await pool.query('UPDATE casino_rounds SET state = $1 WHERE id = $2', [JSON.stringify(state), round.id]);
  res.json({ safe: true, finished: false, multiplier, nextMultiplier: minesMultiplier(mineCount, state.revealed.length + 1), revealed: state.revealed.length });
});

router.post('/mines/:id/cashout', async (req, res) => {
  const loaded = await loadMinesRound(req, res);
  if (!loaded) return;
  const { round, state } = loaded;
  if (state.revealed.length === 0) return res.status(400).json({ error: 'Open at least one tile first' });
  const multiplier = minesMultiplier(state.mines.length, state.revealed.length);
  const payout = roundMoney(Number(round.stake) * multiplier);
  // status guard: a double click cannot pay twice
  const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
    [payout, JSON.stringify({ cashedOut: true, multiplier }), Date.now(), round.id]);
  if (upd.rowCount === 0) return res.status(400).json({ error: 'Round already finished' });
  await creditPayout(req.user.id, payout);
  res.json({ multiplier, payout, mines: state.mines, balance: await getBalance(req.user.id) });
});

// DRAGON TIGER
router.post('/dragon-tiger/deal', async (req, res) => {
  const { stake, bet } = req.body || {};
  if (!Object.keys(DT_PAYOUT).includes(bet)) return res.status(400).json({ error: 'Invalid bet selection' });
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });

  const deck = [];
  for (const suit of CARD_SUITS) for (const v of BJ_VALUES) deck.push({ suit, value: v });
  const a = randomInt(0, 52); let b = randomInt(0, 51); if (b >= a) b += 1; // two different cards
  const dragon = deck[a], tiger = deck[b];
  const rank = (c) => { const v = c.value; return v === 'A' ? 1 : v === 'J' ? 11 : v === 'Q' ? 12 : v === 'K' ? 13 : parseInt(v, 10); };
  const { result, payout } = dragonTigerPayout(bet, rank(dragon), rank(tiger), stake);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'dragontiger', stake, payout, { bet, result });
  res.json({ dragon, tiger, result, payout, balance: await getBalance(req.user.id) });
});

// WHEEL OF FORTUNE ("Rrota e Fatit"): one spin, 24 equal segments (server/wheel.js), pays stake x the segment multiplier.
router.get('/wheel/segments', (req, res) => res.json({ segments: WHEEL_SEGMENTS }));
router.post('/wheel/spin', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  const { index, multiplier } = wheelSpin((n) => randomInt(0, n));
  const payout = roundMoney(stake * multiplier);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'wheel', stake, payout, { index, multiplier });
  res.json({ index, multiplier, payout, balance: await getBalance(req.user.id) });
});

// SUGAR CASCADE: 6x5 scatter-pays slot with tumbles (server/slots/tumble.js). Same wallet / demo rules as the other slots.
router.get('/tumble/info', (req, res) => res.json({
  stakes: SLOT_STAKES, limits: SLOT_LIMITS, demo: isSuperAdmin(req.user.role), cols: tumbleEngine.COLS, rows: tumbleEngine.ROWS, minCluster: tumbleEngine.MIN_CLUSTER,
  paytable: tumbleEngine.PAYTABLE, scatterPay: tumbleEngine.SCATTER_PAY, freeSpins: tumbleEngine.FREE_SPINS, maxWin: tumbleEngine.MAX_WIN_MULTIPLIER,
}));
router.post('/tumble/spin', async (req, res) => {
  const acct = await accountCurrencyOf(req.user.id);
  const currency = req.body?.currency === undefined && acct === 'EUR' ? 'EUR' : normalizeCurrency(req.body?.currency);
  if (!allowsCurrency(acct, currency)) return res.status(400).json({ error: accountCurrencyError(acct) });
  const stake = req.body?.stake;
  if (!validSlotStake(currency, stake)) return res.status(400).json({ error: 'Invalid stake' });
  const draw = () => {
    const r = tumbleEngine.playRound((n) => randomInt(n));
    return {
      spins: r.spins.map((sp) => ({
        first: sp.first, free: sp.free, scatters: sp.scatters, scatterWin: round2(sp.scatterWin * stake), win: round2(sp.win * stake),
        steps: sp.steps.map((st) => ({ wins: st.wins, multiplier: st.multiplier, win: round2(st.win * stake), grid: st.grid })),
      })),
      payout: round2(r.totalMultiplier * stake),
      freeSpins: r.freeSpins,
    };
  };
  return runSlotRound(req, res, 'sugar-cascade', stake, currency, draw);
});

// KENO: pick 1-8 of 40, the house draws 10 (server/keno.js).
router.get('/keno/paytable', (req, res) => res.json({ pool: KENO_POOL, maxPicks: KENO_MAX_PICKS, paytable: KENO_PAYTABLE }));
router.post('/keno/play', async (req, res) => {
  const { stake, picks } = req.body || {};
  const ok = Array.isArray(picks) && picks.length >= 1 && picks.length <= KENO_MAX_PICKS
    && picks.every((n) => Number.isInteger(n) && n >= 1 && n <= KENO_POOL) && new Set(picks).size === picks.length;
  if (!ok) return res.status(400).json({ error: `Pick 1 to ${KENO_MAX_PICKS} different numbers from 1 to ${KENO_POOL}` });
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const paid = await deductStake(req.user.id, stake);
  if (!paid) return res.status(400).json({ error: 'Insufficient balance' });
  const drawn = drawKeno((n) => randomInt(0, n));
  const { hits, multiplier } = kenoResult(picks, drawn);
  const payout = roundMoney(stake * multiplier);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'keno', stake, payout, { picks, drawn, hits });
  res.json({ drawn, hits, multiplier, payout, balance: await getBalance(req.user.id) });
});

// SCRATCH CARD: 9 cells, three equal prizes win (server/scratch.js).
router.post('/scratch/play', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const paid = await deductStake(req.user.id, stake);
  if (!paid) return res.status(400).json({ error: 'Insufficient balance' });
  const { cells, multiplier } = scratchCard((n) => randomInt(0, n));
  const payout = roundMoney(stake * multiplier);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'scratch', stake, payout, { cells, multiplier });
  res.json({ cells, multiplier, payout, balance: await getBalance(req.user.id) });
});

// =====================================================================
// CRASH: the crash point is drawn at the start and stays on the server. The browser polls /state while it watches the
// multiplier climb and calls /cashout; the server decides from its own clock whether the cash-out beat the crash.
// =====================================================================
async function settleCrash(userId, row) {
  const st = JSON.parse(row.state);
  const elapsed = (Date.now() - st.startedAt) / 1000;
  const now = crashEngine.multiplierAt(elapsed);
  const stake = Number(row.stake);
  const finish = async (payout, result) => {
    const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
      [payout, JSON.stringify(result), Date.now(), row.id]);
    if (upd.rowCount === 0) return false;
    if (payout > 0) await creditPayout(userId, payout);
    return true;
  };
  if (st.auto && st.crashPoint >= st.auto && elapsed + 0.05 >= crashEngine.timeToMultiplier(st.auto)) {
    const payout = roundMoney(stake * st.auto);
    await finish(payout, { crashPoint: st.crashPoint, cashedOutAt: st.auto, auto: true });
    return { status: 'WON', multiplier: st.auto, payout, crashPoint: st.crashPoint };
  }
  if (now >= st.crashPoint) {
    await finish(0, { crashPoint: st.crashPoint });
    return { status: 'CRASHED', crashPoint: st.crashPoint, payout: 0 };
  }
  return { status: 'RUNNING', multiplier: now, st };
}
async function loadCrash(req, res) {
  const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
  const row = rows[0];
  if (!row || row.game !== 'crash') { res.status(404).json({ error: 'Round not found' }); return null; }
  if (row.user_id !== req.user.id) { res.status(403).json({ error: 'Not your round' }); return null; }
  return row;
}
router.post('/crash/start', async (req, res) => {
  const { stake } = req.body || {};
  let auto = req.body?.autoCashout;
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  if (auto !== undefined && auto !== null && auto !== '') {
    auto = Number(auto);
    if (!Number.isFinite(auto) || auto < 1.01 || auto > crashEngine.CRASH_MAX) return res.status(400).json({ error: 'Auto cash-out must be between 1.01x and 1000x' });
    auto = Math.round(auto * 100) / 100;
  } else auto = null;
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  const crashPoint = crashEngine.drawCrashPoint((n) => randomInt(n));
  const roundId = randomUUID();
  await pool.query(
    `INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at) VALUES ($1,$2,'crash',$3,'PLAYING',$4,$5)`,
    [roundId, req.user.id, stake, JSON.stringify({ crashPoint, auto, startedAt: Date.now() }), Date.now()]
  );
  res.json({ roundId, growth: crashEngine.GROWTH, autoCashout: auto, balance: await getBalance(req.user.id) });
});
router.get('/crash/:id/state', async (req, res) => {
  const row = await loadCrash(req, res); if (!row) return;
  if (row.status !== 'PLAYING') {
    const r = JSON.parse(row.result || '{}');
    return res.json(r.cashedOutAt ? { status: 'WON', multiplier: r.cashedOutAt, payout: Number(row.payout), crashPoint: r.crashPoint, balance: await getBalance(req.user.id) }
      : { status: 'CRASHED', crashPoint: r.crashPoint, payout: Number(row.payout), balance: await getBalance(req.user.id) });
  }
  const out = await settleCrash(req.user.id, row);
  if (out.status === 'RUNNING') return res.json({ status: 'RUNNING', multiplier: out.multiplier });
  res.json({ ...out, balance: await getBalance(req.user.id) });
});
router.post('/crash/:id/cashout', async (req, res) => {
  const row = await loadCrash(req, res); if (!row) return;
  if (row.status !== 'PLAYING') return res.status(400).json({ error: 'Round already finished' });
  const out = await settleCrash(req.user.id, row);
  if (out.status !== 'RUNNING') return res.json({ ...out, balance: await getBalance(req.user.id) });
  const multiplier = out.multiplier;
  const payout = roundMoney(Number(row.stake) * multiplier);
  const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
    [payout, JSON.stringify({ crashPoint: out.st.crashPoint, cashedOutAt: multiplier }), Date.now(), row.id]);
  if (upd.rowCount === 0) return res.status(400).json({ error: 'Round already finished' });
  await creditPayout(req.user.id, payout);
  res.json({ status: 'WON', multiplier, payout, crashPoint: out.st.crashPoint, balance: await getBalance(req.user.id) });
});

// =====================================================================
// HI-LO: higher / lower card chain
// =====================================================================
const hiloOptions = (rank, total) => ({
  higher: hiloEngine.winCount(rank, 'higher') ? Math.min(hiloEngine.HILO_MAX, hiloEngine.roundMult(total * hiloEngine.stepMultiplier(rank, 'higher'))) : 0,
  lower: hiloEngine.winCount(rank, 'lower') ? Math.min(hiloEngine.HILO_MAX, hiloEngine.roundMult(total * hiloEngine.stepMultiplier(rank, 'lower'))) : 0,
});
async function loadHilo(req, res) {
  const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
  const row = rows[0];
  if (!row || row.game !== 'hilo') { res.status(404).json({ error: 'Round not found' }); return null; }
  if (row.user_id !== req.user.id) { res.status(403).json({ error: 'Not your round' }); return null; }
  if (row.status !== 'PLAYING') { res.status(400).json({ error: 'Round already finished' }); return null; }
  return { row, st: JSON.parse(row.state) };
}
router.post('/hilo/start', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  const rank = hiloEngine.drawRank((n) => randomInt(n));
  const suit = randomInt(4);
  const roundId = randomUUID();
  await pool.query(`INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at) VALUES ($1,$2,'hilo',$3,'PLAYING',$4,$5)`,
    [roundId, req.user.id, stake, JSON.stringify({ rank, suit, total: 1, steps: 0 }), Date.now()]);
  res.json({ roundId, card: { rank, suit }, total: 1, options: hiloOptions(rank, 1), balance: await getBalance(req.user.id) });
});
router.post('/hilo/:id/guess', async (req, res) => {
  const guess = req.body?.guess;
  if (guess !== 'higher' && guess !== 'lower') return res.status(400).json({ error: 'Invalid guess' });
  const loaded = await loadHilo(req, res); if (!loaded) return;
  const { row, st } = loaded;
  const step = hiloEngine.playStep({ rank: st.rank, guess, total: st.total }, (n) => randomInt(n));
  if (step.error) return res.status(400).json({ error: 'That guess is impossible for this card' });
  const suit = randomInt(4);
  if (!step.won) {
    await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=0, result=$1, resolved_at=$2 WHERE id=$3 AND status='PLAYING'`,
      [JSON.stringify({ steps: st.steps, lostOn: step.next }), Date.now(), row.id]);
    return res.json({ won: false, card: { rank: step.next, suit }, payout: 0, finished: true, balance: await getBalance(req.user.id) });
  }
  const next = { rank: step.next, suit, total: step.total, steps: st.steps + 1 };
  if (step.capped) {
    const payout = roundMoney(Number(row.stake) * next.total);
    const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', state=$1, payout=$2, result=$3, resolved_at=$4 WHERE id=$5 AND status='PLAYING'`,
      [JSON.stringify(next), payout, JSON.stringify({ steps: next.steps, maxed: true }), Date.now(), row.id]);
    if (upd.rowCount) await creditPayout(req.user.id, payout);
    return res.json({ won: true, card: { rank: next.rank, suit }, total: next.total, payout, finished: true, balance: await getBalance(req.user.id) });
  }
  await pool.query('UPDATE casino_rounds SET state = $1 WHERE id = $2', [JSON.stringify(next), row.id]);
  res.json({ won: true, card: { rank: next.rank, suit }, total: next.total, steps: next.steps, options: hiloOptions(next.rank, next.total), finished: false });
});
router.post('/hilo/:id/cashout', async (req, res) => {
  const loaded = await loadHilo(req, res); if (!loaded) return;
  const { row, st } = loaded;
  if (st.steps < 1) return res.status(400).json({ error: 'Win at least one guess first' });
  const payout = roundMoney(Number(row.stake) * st.total);
  const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
    [payout, JSON.stringify({ steps: st.steps, cashedOut: true, multiplier: st.total }), Date.now(), row.id]);
  if (upd.rowCount === 0) return res.status(400).json({ error: 'Round already finished' });
  await creditPayout(req.user.id, payout);
  res.json({ multiplier: st.total, payout, balance: await getBalance(req.user.id) });
});

// =====================================================================
// HOLD & WIN: the whole bonus is drawn at once (server/holdwin.js); the browser plays it back step by step.
// =====================================================================
router.get('/holdwin/info', (req, res) => res.json({
  cols: holdWinEngine.COLS, rows: holdWinEngine.ROWS, minTrigger: holdWinEngine.MIN_TRIGGER, lives: holdWinEngine.START_LIVES,
  coinTable: holdWinEngine.COIN_TABLE.map((c) => c.v), fullBoardBonus: holdWinEngine.FULL_BOARD_BONUS, maxWin: holdWinEngine.MAX_WIN_MULTIPLIER,
}));
router.post('/holdwin/play', async (req, res) => {
  const { stake } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  const round = holdWinEngine.playRound((n) => randomInt(n));
  const payout = roundMoney(stake * round.multiplier);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'holdwin', stake, payout, { coins: round.start.length, full: round.full, multiplier: round.multiplier });
  res.json({ ...round, payout, balance: await getBalance(req.user.id) });
});

export default router;
