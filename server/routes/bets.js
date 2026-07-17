import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { requireAuth } from './auth.js';
import { resolveCurrentOdds } from '../oddsUtils.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const bets = db.prepare('SELECT * FROM bets WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const selStmt = db.prepare('SELECT * FROM bet_selections WHERE bet_id = ?');
  const withSelections = bets.map((b) => ({
    ...b,
    selections: selStmt.all(b.id),
  }));
  res.json({ bets: withSelections });
});

router.post('/', (req, res) => {
  const { type, stake, selections } = req.body || {};

  if (!Array.isArray(selections) || selections.length === 0) {
    return res.status(400).json({ error: 'At least one selection is required' });
  }
  if (typeof stake !== 'number' || stake <= 0) {
    return res.status(400).json({ error: 'Stake must be a positive number' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.balance < stake) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // Re-verify each selection's odds against the current cache instead of trusting the client
  const matchStmt = db.prepare('SELECT * FROM matches_cache WHERE id = ?');
  let totalOdds = 1;
  const verifiedSelections = [];

  for (const sel of selections) {
    const matchRow = matchStmt.get(sel.matchId);
    if (!matchRow) {
      return res.status(400).json({ error: `Match ${sel.matchId} not found or no longer available` });
    }
    const currentOdds = resolveCurrentOdds(matchRow, sel.marketId, sel.selectionId);
    if (currentOdds === null) {
      return res.status(400).json({ error: `Selection ${sel.selectionId} in market ${sel.marketId} not found in current odds — it may have closed or moved` });
    }
    totalOdds *= currentOdds;
    verifiedSelections.push({ ...sel, odds: currentOdds });
  }

  const betId = randomUUID();
  const potentialReturn = Number((stake * totalOdds).toFixed(2));

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(stake, user.id);
    db.prepare(`
      INSERT INTO bets (id, user_id, type, stake, total_odds, potential_return, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(betId, user.id, type || 'SINGLE', stake, totalOdds, potentialReturn, Date.now());

    const insertSel = db.prepare(`
      INSERT INTO bet_selections
        (bet_id, match_id, match_home, match_away, market_id, market_name, selection_id, selection_name, odds, status)
      VALUES (@bet_id, @match_id, @match_home, @match_away, @market_id, @market_name, @selection_id, @selection_name, @odds, 'PENDING')
    `);
    for (const sel of verifiedSelections) {
      insertSel.run({
        bet_id: betId,
        match_id: sel.matchId,
        match_home: sel.matchHome,
        match_away: sel.matchAway,
        market_id: sel.marketId,
        market_name: sel.marketName,
        selection_id: sel.selectionId,
        selection_name: sel.selectionName,
        odds: sel.odds,
      });
    }
  });
  tx();

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.status(201).json({
    bet: { id: betId, totalOdds, potentialReturn, stake },
    balance: updatedUser.balance,
  });
});

export default router;
