import express from 'express';
import { randomUUID, randomInt } from 'crypto';
import pool from '../db.js';
import { requireAuth, JWT_SECRET } from './auth.js';
import { getWinGate, gatedDraw } from '../casinoGate.js';
const RI = (n) => randomInt(n);
import { makeRaceToken, readRaceToken } from '../raceOdds.js';
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
import * as chain from '../chain.js';
import * as horseEngine from '../horses.js';
import * as cupsEngine from '../cups.js';
import * as liveRoulette from '../liveRoulette.js';
import * as liveHorses from '../liveHorses.js';
import * as dogEngine from '../dogs.js';
import * as liveDogs from '../liveDogs.js';
import * as liveCrash from '../liveCrash.js';
import * as liveKeno from '../liveKeno.js';
import { simulatedFeed, simulatedPlayers, simulatedPlaying } from '../liveSim.js';
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

router.get('/slot-games', async (req, res) => {
  // "playing now": real players of the last 5 minutes per game, topped up with simulated ones (LIVE_SIM_ENABLED=0 switches that off)
  const ids = VIDEO_SLOTS.map((g) => g.id);
  const playing = {};
  try {
    const { rows } = await pool.query(
      `SELECT r.game, COUNT(DISTINCT r.user_id)::int AS n FROM casino_rounds r JOIN users u ON u.id = r.user_id
        WHERE r.created_at > $1 AND u.role <> 'SUPER_ADMIN' GROUP BY r.game`, [Date.now() - 5 * 60 * 1000]);
    for (const r of rows) playing[r.game] = r.n;
  } catch { /* counts are cosmetic */ }
  const sim = process.env.LIVE_SIM_ENABLED !== '0';
  if (sim) { const extra = simulatedPlaying(ids); for (const id of ids) playing[id] = (playing[id] || 0) + extra[id]; }
  res.json({ games: VIDEO_SLOTS.map(publicGame), stakes: SLOT_STAKES, limits: SLOT_LIMITS, demo: isSuperAdmin(req.user.role), playing, simulatedPlayers: sim });
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
  if (currency === 'EUR') return res.status(400).json({ error: 'Casino luan vetëm me kredite demo (pa euro)' });
  const stake = req.body?.stake;
  if (!validSlotStake(currency, stake)) return res.status(400).json({ error: 'Invalid stake' });

  const gate = await getWinGate();
  const draw = () => {
    const r = gatedDraw(() => playRound(game, (n) => randomInt(n)), (x) => x.totalMultiplier > 0, gate, (n) => randomInt(n));
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

  const gate = await getWinGate();
  const { reels, multiplier } = gatedDraw(() => { const rl = spinSlotReels(game); return { reels: rl, multiplier: slotMultiplier(game, rl) }; }, (x) => x.multiplier > 0, gate, RI);
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

  const gate = await getWinGate();
  const { dice, result } = gatedDraw(() => { const d = [rollDie(), rollDie()]; return { dice: d, result: diceOutcome(d[0], d[1]) }; }, (x) => x.result === selectedBet, gate, RI);
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

  const gate = await getWinGate();
  const mults = plinkoMultipliers(rows, risk);
  const { path, bucket, multiplier } = gatedDraw(() => {
    const pth = Array.from({ length: rows }, () => randomInt(0, 2)); // 1 = right
    const bk = pth.reduce((a, b) => a + b, 0);
    return { path: pth, bucket: bk, multiplier: mults[bk] };
  }, (x) => x.multiplier > 1, gate, RI);
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
  const rank = (c) => { const v = c.value; return v === 'A' ? 1 : v === 'J' ? 11 : v === 'Q' ? 12 : v === 'K' ? 13 : parseInt(v, 10); };
  const gate = await getWinGate();
  const { dragon, tiger } = gatedDraw(() => {
    const a = randomInt(0, 52); let b = randomInt(0, 51); if (b >= a) b += 1; // two different cards
    return { dragon: deck[a], tiger: deck[b] };
  }, (x) => dragonTigerPayout(bet, rank(x.dragon), rank(x.tiger), stake).payout > stake, gate, RI);
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
  const gate = await getWinGate();
  const { index, multiplier } = gatedDraw(() => wheelSpin((n) => randomInt(0, n)), (x) => x.multiplier > 0, gate, (n) => randomInt(n));
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
  if (currency === 'EUR') return res.status(400).json({ error: 'Casino luan vetëm me kredite demo (pa euro)' });
  const stake = req.body?.stake;
  if (!validSlotStake(currency, stake)) return res.status(400).json({ error: 'Invalid stake' });
  const gate = await getWinGate();
  const draw = () => {
    const r = gatedDraw(() => tumbleEngine.playRound((n) => randomInt(n)), (x) => x.totalMultiplier > 0, gate, (n) => randomInt(n));
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
  const gate = await getWinGate();
  const { drawn, hits, multiplier } = gatedDraw(() => { const dr = drawKeno((n) => randomInt(0, n)); return { drawn: dr, ...kenoResult(picks, dr) }; }, (x) => x.multiplier > 0, gate, RI);
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
  const gate = await getWinGate();
  const { cells, multiplier } = gatedDraw(() => scratchCard((n) => randomInt(0, n)), (x) => x.multiplier > 0, gate, RI);
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
  const gate = await getWinGate();
  const round = gatedDraw(() => holdWinEngine.playRound((n) => randomInt(n)), (x) => x.multiplier > 0, gate, RI);
  const payout = roundMoney(stake * round.multiplier);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'holdwin', stake, payout, { coins: round.start.length, full: round.full, multiplier: round.multiplier });
  res.json({ ...round, payout, balance: await getBalance(req.user.id) });
});

// =====================================================================
// CHAIN GAMES: Penalty Shootout and Gold Tower share one engine (server/chain.js)
// =====================================================================
function registerChainGame(key, cfgFor) {
  async function load(req, res) {
    const { rows } = await pool.query('SELECT * FROM casino_rounds WHERE id = $1', [req.params.id]);
    const row = rows[0];
    if (!row || row.game !== key) { res.status(404).json({ error: 'Round not found' }); return null; }
    if (row.user_id !== req.user.id) { res.status(403).json({ error: 'Not your round' }); return null; }
    if (row.status !== 'PLAYING') { res.status(400).json({ error: 'Round already finished' }); return null; }
    return { row, st: JSON.parse(row.state) };
  }
  router.post(`/${key}/start`, async (req, res) => {
    const { stake } = req.body || {};
    if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
    const cfg = cfgFor(req.body || {});
    if (!cfg) return res.status(400).json({ error: 'Invalid difficulty' });
    const ok = await deductStake(req.user.id, stake);
    if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
    const roundId = randomUUID();
    await pool.query(`INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at) VALUES ($1,$2,$3,$4,'PLAYING',$5,$6)`,
      [roundId, req.user.id, key, stake, JSON.stringify({ cfg, total: 1, steps: 0 }), Date.now()]);
    res.json({ roundId, cfg, step: chain.roundMult(chain.stepMultiplier(cfg)), balance: await getBalance(req.user.id) });
  });
  router.post(`/${key}/:id/pick`, async (req, res) => {
    const loaded = await load(req, res); if (!loaded) return;
    const { row, st } = loaded;
    const r = chain.playStep({ cfg: st.cfg, total: st.total, steps: st.steps, choice: req.body?.choice }, (n) => randomInt(n));
    if (r.error) return res.status(400).json({ error: 'Invalid choice' });
    if (!r.safe) {
      await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=0, result=$1, resolved_at=$2 WHERE id=$3 AND status='PLAYING'`,
        [JSON.stringify({ steps: st.steps, hit: req.body.choice }), Date.now(), row.id]);
      return res.json({ safe: false, traps: r.traps, finished: true, payout: 0, balance: await getBalance(req.user.id) });
    }
    const next = { cfg: st.cfg, total: r.total, steps: r.steps };
    if (r.finished) {
      const payout = roundMoney(Number(row.stake) * r.total);
      const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', state=$1, payout=$2, result=$3, resolved_at=$4 WHERE id=$5 AND status='PLAYING'`,
        [JSON.stringify(next), payout, JSON.stringify({ steps: r.steps, completed: true }), Date.now(), row.id]);
      if (upd.rowCount) await creditPayout(req.user.id, payout);
      return res.json({ safe: true, traps: r.traps, total: r.total, steps: r.steps, finished: true, payout, balance: await getBalance(req.user.id) });
    }
    await pool.query('UPDATE casino_rounds SET state = $1 WHERE id = $2', [JSON.stringify(next), row.id]);
    res.json({ safe: true, traps: r.traps, total: r.total, steps: r.steps, finished: false });
  });
  router.post(`/${key}/:id/cashout`, async (req, res) => {
    const loaded = await load(req, res); if (!loaded) return;
    const { row, st } = loaded;
    if (st.steps < 1) return res.status(400).json({ error: 'Make at least one safe pick first' });
    const payout = roundMoney(Number(row.stake) * st.total);
    const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
      [payout, JSON.stringify({ steps: st.steps, cashedOut: true, multiplier: st.total }), Date.now(), row.id]);
    if (upd.rowCount === 0) return res.status(400).json({ error: 'Round already finished' });
    await creditPayout(req.user.id, payout);
    res.json({ multiplier: st.total, payout, balance: await getBalance(req.user.id) });
  });
}
registerChainGame('penalty', () => chain.PENALTY_CFG);
registerChainGame('tower', (body) => chain.TOWER_LEVELS[body.difficulty || 'medium'] || null);
router.get('/tower/levels', (req, res) => res.json({ levels: Object.fromEntries(Object.entries(chain.TOWER_LEVELS).map(([k, c]) => [k, { ...c, step: chain.roundMult(chain.stepMultiplier(c)) }])) }));

// =====================================================================
// HORSE RACE
// =====================================================================
router.get('/horses/info', (req, res) => {
  const { seed, token } = makeRaceToken(JWT_SECRET);
  res.json({ horses: horseEngine.horsesFor(seed), token });
});
router.post('/horses/race', async (req, res) => {
  const { stake, horse, token } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  if (!Number.isInteger(horse) || horse < 0 || horse >= horseEngine.HORSES.length) return res.status(400).json({ error: 'Pick a horse' });
  let horses = horseEngine.HORSES;
  if (token !== undefined) {
    const horseSeed = readRaceToken(token, JWT_SECRET);
    if (horseSeed === null) return res.status(400).json({ error: 'The odds expired, reload the race' });
    horses = horseEngine.horsesFor(horseSeed);
  }
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  const gate = await getWinGate();
  const order = gatedDraw(() => horseEngine.drawOrder((n) => randomInt(n), horses), (o) => o[0] === horse, gate, RI);
  const payout = horseEngine.horsePayout(stake, horse, order, horses);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'horses', stake, payout, { horse, order, odds: horses[horse].odds });
  res.json({ order, payout, odds: horses[horse].odds, balance: await getBalance(req.user.id) });
});

// =====================================================================
// THREE CUPS
// =====================================================================
router.post('/cups/play', async (req, res) => {
  const { stake, cup } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  if (!Number.isInteger(cup) || cup < 0 || cup > 2) return res.status(400).json({ error: 'Pick a cup' });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  const gate = await getWinGate();
  const shuffle = gatedDraw(() => cupsEngine.drawShuffle((n) => randomInt(n)), (x) => x.final === cup, gate, RI);
  const won = shuffle.final === cup;
  const payout = won ? roundMoney(stake * cupsEngine.CUPS_PAYOUT) : 0;
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'cups', stake, payout, { cup, final: shuffle.final });
  res.json({ ...shuffle, won, payout, multiplier: cupsEngine.CUPS_PAYOUT, balance: await getBalance(req.user.id) });
});

// =====================================================================
// LIVE WINS: the most recent rounds of REAL players (names masked), never invented.
// =====================================================================
export const maskName = (u) => { const t = String(u || '').trim(); return t.length <= 2 ? `${t[0] || '?'}***` : `${t.slice(0, 2)}***${t.slice(-1)}`; };
router.get('/live', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.game, r.currency, r.stake, r.payout, r.created_at, u.username, u.role
       FROM casino_rounds r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'FINISHED' AND u.role <> 'SUPER_ADMIN' AND r.created_at > $1
      ORDER BY r.created_at DESC LIMIT 40`, [Date.now() - 24 * 3600 * 1000]);
  const feed = rows.map((r) => ({
    game: r.game, currency: r.currency === 'EUR' ? 'EUR' : 'ALL', stake: Number(r.stake), payout: Number(r.payout),
    multiplier: Number(r.stake) > 0 ? Math.round((Number(r.payout) / Number(r.stake)) * 100) / 100 : 0, at: Number(r.created_at), player: maskName(r.username),
  }));
  const { rows: cnt } = await pool.query(
    `SELECT COUNT(DISTINCT user_id)::int AS players, COUNT(*)::int AS rounds FROM casino_rounds r JOIN users u ON u.id = r.user_id
      WHERE r.created_at > $1 AND u.role <> 'SUPER_ADMIN'`, [Date.now() - 3600 * 1000]);
  // This is a demo-money simulator, so the Live strip is topped up with simulated players (flagged `simulated`).
  // Set LIVE_SIM_ENABLED=0 in the server env to switch the simulation off and show real rounds only.
  const preview = process.env.LIVE_SIM_ENABLED !== '0';
  let all = feed; let players = cnt[0]?.players || 0; let rounds = cnt[0]?.rounds || 0;
  if (preview) {
    const sim = simulatedFeed();
    all = [...feed, ...sim].sort((a, b) => b.at - a.at).slice(0, 40);
    players += simulatedPlayers(); rounds += sim.filter((f) => f.at > Date.now() - 3600 * 1000).length * 6;
  }
  res.json({ feed: all, playersLastHour: players, roundsLastHour: rounds, preview });
});

// =====================================================================
// LIVE ROULETTE: shared wheel, a new round every 30 s (server/liveRoulette.js)
// =====================================================================
async function liveRouletteResult(round) {
  const key = `liveroulette_${round}`;
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, String(randomInt(37))]);
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return Number(rows[0].value);
}
async function liveRouletteHistory(current) {
  const keys = Array.from({ length: 14 }, (_, i) => `liveroulette_${current - 1 - i}`);
  const { rows } = await pool.query('SELECT key, value FROM kv_store WHERE key = ANY($1)', [keys]);
  const m = new Map(rows.map((r) => [r.key, Number(r.value)]));
  return keys.map((k) => m.get(k)).filter((v) => v !== undefined);
}
async function settleLiveRoulette(userId) {
  const now = Date.now(); const cur = liveRoulette.roundNo(now); const { phase } = liveRoulette.phaseAt(now);
  const { rows } = await pool.query(`SELECT * FROM casino_rounds WHERE user_id = $1 AND game = 'liveroulette' AND status = 'PLAYING'`, [userId]);
  const settled = [];
  for (const row of rows) {
    const st = JSON.parse(row.state);
    if (!(st.round < cur || (st.round === cur && phase !== 'betting'))) continue;
    const result = await liveRouletteResult(st.round);
    const payout = liveRoulette.settleBets(st.bets, result);
    const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
      [payout, JSON.stringify({ round: st.round, result }), Date.now(), row.id]);
    if (upd.rowCount === 0) continue;
    if (payout > 0) await creditPayout(userId, payout);
    settled.push({ round: st.round, result, staked: Number(row.stake), payout });
  }
  return settled;
}
router.get('/live-roulette/state', async (req, res) => {
  const now = Date.now(); const round = liveRoulette.roundNo(now); const { phase, msLeft } = liveRoulette.phaseAt(now);
  const settled = await settleLiveRoulette(req.user.id);
  const result = phase === 'betting' ? null : await liveRouletteResult(round);
  const { rows: mine } = await pool.query(`SELECT state FROM casino_rounds WHERE user_id = $1 AND game = 'liveroulette' AND status = 'PLAYING'`, [req.user.id]);
  const myBets = {};
  for (const r of mine) { const st = JSON.parse(r.state); if (st.round === round) for (const [k, v] of Object.entries(st.bets)) myBets[k] = (myBets[k] || 0) + v; }
  const sim = process.env.LIVE_SIM_ENABLED !== '0';
  res.json({ serverNow: now, round, phase, msLeft, cycleMs: liveRoulette.CYCLE_MS, betMs: liveRoulette.BET_MS, result, history: await liveRouletteHistory(round), myBets, settled,
    balance: await getBalance(req.user.id), tablePlayers: sim ? 14 + ((round * 7) % 29) : undefined, simulatedPlayers: sim });
});
router.post('/live-roulette/bet', async (req, res) => {
  const { bets, round } = req.body || {};
  const now = Date.now(); const cur = liveRoulette.roundNo(now);
  if (liveRoulette.phaseAt(now).phase !== 'betting' || round !== cur) return res.status(400).json({ error: 'Betting is closed for this spin' });
  if (!bets || typeof bets !== 'object' || Array.isArray(bets) || Object.keys(bets).length === 0) return res.status(400).json({ error: 'At least one bet is required' });
  let total = 0; const clean = {};
  for (const [spot, amount] of Object.entries(bets)) {
    if (!liveRoulette.validSpot(spot)) return res.status(400).json({ error: `Unknown bet spot: ${spot}` });
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 !== amount) return res.status(400).json({ error: `Invalid bet amount for ${spot}` });
    clean[spot] = amount; total += amount;
  }
  total = roundMoney(total);
  if (!validateStake(total)) return res.status(400).json({ error: `Total bet must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const { rows: mine } = await pool.query(`SELECT COALESCE(SUM(stake),0) AS s FROM casino_rounds WHERE user_id = $1 AND game = 'liveroulette' AND status = 'PLAYING' AND state::json->>'round' = $2`, [req.user.id, String(cur)]);
  if (Number(mine[0].s) + total > liveRoulette.MAX_TABLE_BET) return res.status(400).json({ error: `Table limit is ${liveRoulette.MAX_TABLE_BET} per spin` });
  const ok = await deductStake(req.user.id, total);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  await pool.query(`INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at) VALUES ($1,$2,'liveroulette',$3,'PLAYING',$4,$5)`,
    [randomUUID(), req.user.id, total, JSON.stringify({ round: cur, bets: clean }), Date.now()]);
  res.json({ ok: true, balance: await getBalance(req.user.id) });
});

// =====================================================================
// LIVE HORSE RACE: shared race every 45 s (server/liveHorses.js)
// =====================================================================
async function liveHorsesResult(round) {
  const key = `livehorses_${round}`;
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, liveHorses.draw((n) => randomInt(n), round).join(',')]);
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return rows[0].value.split(',').map(Number);
}
async function settleLiveHorses(userId) {
  const now = Date.now(); const cur = liveHorses.roundNo(now); const { phase } = liveHorses.phaseAt(now);
  const { rows } = await pool.query(`SELECT * FROM casino_rounds WHERE user_id = $1 AND game = 'livehorses' AND status = 'PLAYING'`, [userId]);
  const settled = [];
  for (const row of rows) {
    const st = JSON.parse(row.state);
    if (!(st.round < cur || (st.round === cur && phase !== 'betting'))) continue;
    const order = await liveHorsesResult(st.round);
    const payout = liveHorses.settle(st.bets, order, st.round);
    const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
      [payout, JSON.stringify({ round: st.round, order }), Date.now(), row.id]);
    if (upd.rowCount === 0) continue;
    if (payout > 0) await creditPayout(userId, payout);
    settled.push({ round: st.round, order, staked: Number(row.stake), payout });
  }
  return settled;
}
router.get('/live-horses/state', async (req, res) => {
  const now = Date.now(); const round = liveHorses.roundNo(now); const { phase, msLeft } = liveHorses.phaseAt(now);
  const settled = await settleLiveHorses(req.user.id);
  const order = phase === 'betting' ? null : await liveHorsesResult(round);
  const { rows: mine } = await pool.query(`SELECT state FROM casino_rounds WHERE user_id = $1 AND game = 'livehorses' AND status = 'PLAYING'`, [req.user.id]);
  const myBets = {};
  for (const r of mine) { const st = JSON.parse(r.state); if (st.round === round) for (const [k, v] of Object.entries(st.bets)) myBets[k] = (myBets[k] || 0) + v; }
  const prev = []; for (let i = 1; i <= 8; i += 1) { const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [`livehorses_${round - i}`]); if (rows[0]) prev.push(Number(rows[0].value.split(',')[0])); }
  const sim = process.env.LIVE_SIM_ENABLED !== '0';
  res.json({ serverNow: now, round, phase, msLeft, cycleMs: liveHorses.CYCLE_MS, betMs: liveHorses.BET_MS, order, winners: prev, myBets, settled, balance: await getBalance(req.user.id),
    tablePlayers: sim ? 11 + ((round * 5) % 23) : undefined, simulatedPlayers: sim, horses: liveHorses.horsesForRound(round) });
});
router.post('/live-horses/bet', async (req, res) => {
  const { bets, round } = req.body || {};
  const now = Date.now(); const cur = liveHorses.roundNo(now);
  if (liveHorses.phaseAt(now).phase !== 'betting' || round !== cur) return res.status(400).json({ error: 'Betting is closed for this race' });
  if (!bets || typeof bets !== 'object' || Array.isArray(bets) || Object.keys(bets).length === 0) return res.status(400).json({ error: 'At least one bet is required' });
  let total = 0; const clean = {};
  for (const [h, amount] of Object.entries(bets)) {
    if (!liveHorses.validHorse(h)) return res.status(400).json({ error: 'Unknown horse' });
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 !== amount) return res.status(400).json({ error: 'Invalid bet amount' });
    clean[h] = amount; total += amount;
  }
  total = roundMoney(total);
  if (!validateStake(total)) return res.status(400).json({ error: `Total bet must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const { rows: mine } = await pool.query(`SELECT COALESCE(SUM(stake),0) AS s FROM casino_rounds WHERE user_id = $1 AND game = 'livehorses' AND status = 'PLAYING' AND state::json->>'round' = $2`, [req.user.id, String(cur)]);
  if (Number(mine[0].s) + total > liveHorses.MAX_TABLE_BET) return res.status(400).json({ error: `Table limit is ${liveHorses.MAX_TABLE_BET} per race` });
  const ok = await deductStake(req.user.id, total);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  await pool.query(`INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at) VALUES ($1,$2,'livehorses',$3,'PLAYING',$4,$5)`,
    [randomUUID(), req.user.id, total, JSON.stringify({ round: cur, bets: clean }), Date.now()]);
  res.json({ ok: true, balance: await getBalance(req.user.id) });
});

// =====================================================================
// DOG RACE (single) and LIVE DOG RACE (shared, every 40 s)
// =====================================================================
router.get('/dogs/info', (req, res) => {
  const { seed, token } = makeRaceToken(JWT_SECRET);
  res.json({ dogs: dogEngine.dogsFor(seed), token });
});
router.post('/dogs/race', async (req, res) => {
  const { stake, dog, token } = req.body || {};
  if (!validateStake(stake)) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  if (!Number.isInteger(dog) || dog < 0 || dog >= dogEngine.DOGS.length) return res.status(400).json({ error: 'Pick a dog' });
  // An app that was opened before this change sends no token and keeps the old fixed odds it shows.
  let dogs = dogEngine.DOGS;
  if (token !== undefined) {
    const dogSeed = readRaceToken(token, JWT_SECRET);
    if (dogSeed === null) return res.status(400).json({ error: 'The odds expired, reload the race' });
    dogs = dogEngine.dogsFor(dogSeed);
  }
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  const gate = await getWinGate();
  const order = gatedDraw(() => dogEngine.drawOrder((n) => randomInt(n), dogs), (o) => o[0] === dog, gate, RI);
  const payout = dogEngine.dogPayout(stake, dog, order, dogs);
  await creditPayout(req.user.id, payout);
  await logRound(req.user.id, 'dogs', stake, payout, { dog, order, odds: dogs[dog].odds });
  res.json({ order, payout, odds: dogs[dog].odds, balance: await getBalance(req.user.id) });
});

// Shared "bet, then race" table, parameterised so every live race game uses the same code path.
function registerLiveRace({ path, game, engine }) {
  async function resultOf(round) {
    const key = `${game}_${round}`;
    await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, engine.draw((n) => randomInt(n), round).join(',')]);
    const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
    return rows[0].value.split(',').map(Number);
  }
  async function settleMine(userId) {
    const now = Date.now(); const cur = engine.roundNo(now); const { phase } = engine.phaseAt(now);
    const { rows } = await pool.query(`SELECT * FROM casino_rounds WHERE user_id = $1 AND game = $2 AND status = 'PLAYING'`, [userId, game]);
    const settled = [];
    for (const row of rows) {
      const st = JSON.parse(row.state);
      if (!(st.round < cur || (st.round === cur && phase !== 'betting'))) continue;
      const order = await resultOf(st.round);
      const payout = engine.settle(st.bets, order, st.round);
      const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
        [payout, JSON.stringify({ round: st.round, order }), Date.now(), row.id]);
      if (upd.rowCount === 0) continue;
      if (payout > 0) await creditPayout(userId, payout);
      settled.push({ round: st.round, order, staked: Number(row.stake), payout });
    }
    return settled;
  }
  router.get(`/${path}/state`, async (req, res) => {
    const now = Date.now(); const round = engine.roundNo(now); const { phase, msLeft } = engine.phaseAt(now);
    const settled = await settleMine(req.user.id);
    const order = phase === 'betting' ? null : await resultOf(round);
    const { rows: mine } = await pool.query(`SELECT state FROM casino_rounds WHERE user_id = $1 AND game = $2 AND status = 'PLAYING'`, [req.user.id, game]);
    const myBets = {};
    for (const r of mine) { const st = JSON.parse(r.state); if (st.round === round) for (const [k, v] of Object.entries(st.bets)) myBets[k] = (myBets[k] || 0) + v; }
    const keys = Array.from({ length: 8 }, (_, i) => `${game}_${round - 1 - i}`);
    const { rows: prev } = await pool.query('SELECT key, value FROM kv_store WHERE key = ANY($1)', [keys]);
    const pm = new Map(prev.map((r) => [r.key, Number(r.value.split(',')[0])]));
    const winners = keys.map((k) => pm.get(k)).filter((v) => v !== undefined);
    const sim = process.env.LIVE_SIM_ENABLED !== '0';
    res.json({ serverNow: now, round, phase, msLeft, cycleMs: engine.CYCLE_MS, betMs: engine.BET_MS, order, winners, myBets, settled, balance: await getBalance(req.user.id),
      tablePlayers: sim ? 12 + ((round * 5) % 27) : undefined, simulatedPlayers: sim, runners: engine.runnersFor ? engine.runnersFor(round) : engine.RUNNERS, ...(engine.FORECAST ? { forecast: engine.forecastFor(engine.runnersFor(round)) } : {}) });
  });
  router.post(`/${path}/bet`, async (req, res) => {
    const { bets, round } = req.body || {};
    const now = Date.now(); const cur = engine.roundNo(now);
    if (engine.phaseAt(now).phase !== 'betting' || round !== cur) return res.status(400).json({ error: 'Betting is closed for this race' });
    if (!bets || typeof bets !== 'object' || Array.isArray(bets) || Object.keys(bets).length === 0) return res.status(400).json({ error: 'At least one bet is required' });
    let total = 0; const clean = {};
    for (const [k, amount] of Object.entries(bets)) {
      if (!engine.validRunner(k)) return res.status(400).json({ error: 'Unknown runner' });
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 !== amount) return res.status(400).json({ error: 'Invalid bet amount' });
      clean[k] = amount; total += amount;
    }
    total = roundMoney(total);
    if (!validateStake(total)) return res.status(400).json({ error: `Total bet must be between ${MIN_STAKE} and ${MAX_STAKE}` });
    const { rows: mine } = await pool.query(`SELECT COALESCE(SUM(stake),0) AS s FROM casino_rounds WHERE user_id = $1 AND game = $2 AND status = 'PLAYING' AND state::json->>'round' = $3`, [req.user.id, game, String(cur)]);
    if (Number(mine[0].s) + total > engine.MAX_TABLE_BET) return res.status(400).json({ error: `Table limit is ${engine.MAX_TABLE_BET} per race` });
    const ok = await deductStake(req.user.id, total);
    if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
    await pool.query(`INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at) VALUES ($1,$2,$3,$4,'PLAYING',$5,$6)`,
      [randomUUID(), req.user.id, game, total, JSON.stringify({ round: cur, bets: clean }), Date.now()]);
    res.json({ ok: true, balance: await getBalance(req.user.id) });
  });
}
registerLiveRace({ path: 'live-dogs', game: 'livedogs', engine: liveDogs });

// =====================================================================
// LIVE CRASH: shared rocket every 40 s (server/liveCrash.js)
// =====================================================================
async function liveCrashPoint(round) {
  const key = `livecrash_${round}`;
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, String(liveCrash.draw((n) => randomInt(n)))]);
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return Number(rows[0].value);
}
async function settleLiveCrash(userId) {
  const now = Date.now(); const cur = liveCrash.roundNo(now);
  const { rows } = await pool.query(`SELECT * FROM casino_rounds WHERE user_id = $1 AND game = 'livecrash' AND status = 'PLAYING'`, [userId]);
  const settled = [];
  for (const row of rows) {
    const st = JSON.parse(row.state);
    if (st.round === cur && liveCrash.infoAt(now).phase === 'betting') continue;
    const cp = await liveCrashPoint(st.round);
    const out = liveCrash.outcome(st, cp, now);
    if (!out.done) continue;
    const payout = roundMoney(Number(row.stake) * out.multiplier);
    const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
      [payout, JSON.stringify({ round: st.round, crashPoint: cp, multiplier: out.multiplier }), Date.now(), row.id]);
    if (upd.rowCount === 0) continue;
    if (payout > 0) await creditPayout(userId, payout);
    settled.push({ round: st.round, crashPoint: cp, staked: Number(row.stake), payout, multiplier: out.multiplier });
  }
  return settled;
}
router.get('/live-crash/state', async (req, res) => {
  const now = Date.now(); const round = liveCrash.roundNo(now);
  const settled = await settleLiveCrash(req.user.id);
  const early = liveCrash.infoAt(now);
  const cp = early.phase === 'betting' ? null : await liveCrashPoint(round);
  const info = liveCrash.infoAt(now, cp);
  const { rows: mine } = await pool.query(`SELECT stake, state FROM casino_rounds WHERE user_id = $1 AND game = 'livecrash' AND status = 'PLAYING'`, [req.user.id]);
  const my = mine.map((r) => ({ ...JSON.parse(r.state), stake: Number(r.stake) })).find((b) => b.round === round) || null;
  const keys = Array.from({ length: 12 }, (_, i) => `livecrash_${round - 1 - i}`);
  const { rows: prev } = await pool.query('SELECT key, value FROM kv_store WHERE key = ANY($1)', [keys]);
  const pm = new Map(prev.map((r) => [r.key, Number(r.value)]));
  const sim = process.env.LIVE_SIM_ENABLED !== '0';
  res.json({ serverNow: now, round, phase: info.phase, msLeft: info.msLeft, t: info.t ?? 0, cycleMs: liveCrash.CYCLE_MS, betMs: liveCrash.BET_MS, growth: liveCrash.GROWTH,
    crashPoint: info.phase === 'crashed' ? cp : null, history: keys.map((k) => pm.get(k)).filter((v) => v !== undefined), my, settled, balance: await getBalance(req.user.id),
    tablePlayers: sim ? 18 + ((round * 11) % 41) : undefined, simulatedPlayers: sim });
});
router.post('/live-crash/bet', async (req, res) => {
  const { stake, round } = req.body || {};
  let auto = req.body?.autoCashout;
  const now = Date.now(); const cur = liveCrash.roundNo(now);
  if (liveCrash.infoAt(now).phase !== 'betting' || round !== cur) return res.status(400).json({ error: 'Betting is closed for this flight' });
  if (!validateStake(stake) || Math.round(stake * 100) / 100 !== stake) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  if (auto !== undefined && auto !== null && auto !== '') {
    auto = Number(auto);
    if (!Number.isFinite(auto) || auto < 1.01 || auto > liveCrash.LIVE_CAP) return res.status(400).json({ error: `Auto cash-out must be between 1.01x and ${liveCrash.LIVE_CAP}x` });
    auto = Math.round(auto * 100) / 100;
  } else auto = null;
  const { rows: mine } = await pool.query(`SELECT COUNT(*)::int AS n FROM casino_rounds WHERE user_id = $1 AND game = 'livecrash' AND status = 'PLAYING' AND state::json->>'round' = $2`, [req.user.id, String(cur)]);
  if (mine[0].n > 0) return res.status(400).json({ error: 'You already have a bet on this flight' });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  await pool.query(`INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at) VALUES ($1,$2,'livecrash',$3,'PLAYING',$4,$5)`,
    [randomUUID(), req.user.id, stake, JSON.stringify({ round: cur, auto }), Date.now()]);
  res.json({ ok: true, balance: await getBalance(req.user.id) });
});
router.post('/live-crash/cashout', async (req, res) => {
  const now = Date.now(); const cur = liveCrash.roundNo(now);
  const { rows } = await pool.query(`SELECT * FROM casino_rounds WHERE user_id = $1 AND game = 'livecrash' AND status = 'PLAYING' AND state::json->>'round' = $2`, [req.user.id, String(cur)]);
  const row = rows[0];
  if (!row || liveCrash.infoAt(now).phase === 'betting') return res.status(400).json({ error: 'Nothing to cash out' });
  const st = JSON.parse(row.state);
  const cp = await liveCrashPoint(cur);
  const out = liveCrash.outcome(st, cp, now);
  const multiplier = out.done ? out.multiplier : liveCrash.multiplierAt((now - liveCrash.flightStart(cur)) / 1000);
  const payout = roundMoney(Number(row.stake) * multiplier);
  const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
    [payout, JSON.stringify({ round: cur, crashPoint: cp, multiplier }), Date.now(), row.id]);
  if (upd.rowCount === 0) return res.status(400).json({ error: 'Already settled' });
  if (payout > 0) await creditPayout(req.user.id, payout);
  res.json({ multiplier, payout, crashed: multiplier === 0, balance: await getBalance(req.user.id) });
});

// =====================================================================
// LIVE KENO: shared draw every 30 s (server/liveKeno.js)
// =====================================================================
async function liveKenoDraw(round) {
  const key = `livekeno_${round}`;
  await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, liveKeno.draw((n) => randomInt(0, n)).join(',')]);
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return rows[0].value.split(',').map(Number);
}
async function settleLiveKeno(userId) {
  const now = Date.now(); const cur = liveKeno.roundNo(now); const { phase } = liveKeno.phaseAt(now);
  const { rows } = await pool.query(`SELECT * FROM casino_rounds WHERE user_id = $1 AND game = 'livekeno' AND status = 'PLAYING'`, [userId]);
  const settled = [];
  for (const row of rows) {
    const st = JSON.parse(row.state);
    if (!(st.round < cur || (st.round === cur && phase !== 'betting'))) continue;
    const drawn = await liveKenoDraw(st.round);
    const { hits, multiplier } = liveKeno.multiplierFor(st.picks, drawn);
    const payout = roundMoney(Number(row.stake) * multiplier);
    const upd = await pool.query(`UPDATE casino_rounds SET status='FINISHED', payout=$1, result=$2, resolved_at=$3 WHERE id=$4 AND status='PLAYING'`,
      [payout, JSON.stringify({ round: st.round, drawn, hits }), Date.now(), row.id]);
    if (upd.rowCount === 0) continue;
    if (payout > 0) await creditPayout(userId, payout);
    settled.push({ round: st.round, drawn, hits, staked: Number(row.stake), payout, multiplier });
  }
  return settled;
}
router.get('/live-keno/state', async (req, res) => {
  const now = Date.now(); const round = liveKeno.roundNo(now); const { phase, msLeft } = liveKeno.phaseAt(now);
  const settled = await settleLiveKeno(req.user.id);
  const drawn = phase === 'betting' ? null : await liveKenoDraw(round);
  const { rows: mine } = await pool.query(`SELECT stake, state FROM casino_rounds WHERE user_id = $1 AND game = 'livekeno' AND status = 'PLAYING'`, [req.user.id]);
  const tickets = mine.map((r) => ({ ...JSON.parse(r.state), stake: Number(r.stake) })).filter((t) => t.round === round);
  const sim = process.env.LIVE_SIM_ENABLED !== '0';
  res.json({ serverNow: now, round, phase, msLeft, cycleMs: liveKeno.CYCLE_MS, betMs: liveKeno.BET_MS, drawn, tickets, settled, balance: await getBalance(req.user.id),
    tablePlayers: sim ? 16 + ((round * 9) % 33) : undefined, simulatedPlayers: sim });
});
router.post('/live-keno/bet', async (req, res) => {
  const { stake, picks, round } = req.body || {};
  const now = Date.now(); const cur = liveKeno.roundNo(now);
  if (liveKeno.phaseAt(now).phase !== 'betting' || round !== cur) return res.status(400).json({ error: 'Betting is closed for this draw' });
  if (!liveKeno.validPicks(picks)) return res.status(400).json({ error: `Pick 1 to ${KENO_MAX_PICKS} different numbers from 1 to ${KENO_POOL}` });
  if (!validateStake(stake) || Math.round(stake * 100) / 100 !== stake) return res.status(400).json({ error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` });
  const { rows: mine } = await pool.query(`SELECT COALESCE(SUM(stake),0) AS s FROM casino_rounds WHERE user_id = $1 AND game = 'livekeno' AND status = 'PLAYING' AND state::json->>'round' = $2`, [req.user.id, String(cur)]);
  if (Number(mine[0].s) + stake > liveKeno.MAX_TABLE_BET) return res.status(400).json({ error: `Table limit is ${liveKeno.MAX_TABLE_BET} per draw` });
  const ok = await deductStake(req.user.id, stake);
  if (!ok) return res.status(400).json({ error: 'Insufficient balance' });
  await pool.query(`INSERT INTO casino_rounds (id, user_id, game, stake, status, state, created_at) VALUES ($1,$2,'livekeno',$3,'PLAYING',$4,$5)`,
    [randomUUID(), req.user.id, stake, JSON.stringify({ round: cur, picks: [...picks].sort((a, b) => a - b) }), Date.now()]);
  res.json({ ok: true, balance: await getBalance(req.user.id) });
});

export default router;
