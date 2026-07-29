import express from 'express';
import pool from '../db.js';
import { getActiveProvider } from '../providers/registry.js';

// This route no longer knows anything about The Odds API, odds-api.io,
// oddspapi, bsd, or highlightly directly. It only talks to the active
// OddsProvider adapter (see providers/registry.js). Swapping or adding a
// provider never requires touching this file.
const router = express.Router();

router.get('/leagues', async (req, res) => {
  try {
    const provider = getActiveProvider();
    const matches = await provider.listMatches({});
    const leagues = [...new Map(matches.map((m) => [m.league, { key: m.league, title: m.league }])).values()];
    res.json({ leagues });
  } catch (err) {
    res.status(502).json({ error: 'Could not load leagues from odds provider', detail: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const provider = getActiveProvider();
    const matches = await provider.listMatches({ league: req.query.league });
    res.json({ matches, hasLiveApiKey: true });
  } catch (err) {
    console.error('Error refreshing odds:', err.message);
    // Fail soft: serve whatever is already cached in the DB rather than a 502,
    // so a slow/flaky upstream provider doesn't take the whole matches page down.
    const { rows } = req.query.league
      ? await pool.query('SELECT * FROM matches_cache WHERE league = $1 ORDER BY start_time ASC', [req.query.league])
      : await pool.query('SELECT * FROM matches_cache ORDER BY start_time ASC LIMIT 200');
    res.json({ matches: rows, hasLiveApiKey: false, degraded: true });
  }
});

router.get('/:id', async (req, res) => {
  const provider = getActiveProvider();
  const match = await provider.getMatch(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json({ match });
});

export default router;
