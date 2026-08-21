import express from 'express';
import pool from '../db.js';
import { fetchLogoUrl, fetchLeagueStandings } from '../scrapers/wikipedia.js';

const router = express.Router();

const LOGO_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — crests don't change often
const STANDINGS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — good enough freshness, spares Wikipedia's infra

// GET /api/scrape/logo?name=Manchester United
router.get('/logo', async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const { rows } = await pool.query('SELECT logo_url, fetched_at FROM logo_cache WHERE name = $1', [name]);
  const cached = rows[0];
  if (cached && Date.now() - Number(cached.fetched_at) < LOGO_CACHE_TTL_MS) {
    return res.json({ name, logoUrl: cached.logo_url, cached: true });
  }

  try {
    const logoUrl = await fetchLogoUrl(name);
    await pool.query(
      `INSERT INTO logo_cache (name, logo_url, fetched_at) VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET logo_url = excluded.logo_url, fetched_at = excluded.fetched_at`,
      [name, logoUrl, Date.now()]
    );
    res.json({ name, logoUrl, cached: false });
  } catch (err) {
    // Serve stale cache rather than fail outright, if we have anything.
    if (cached) return res.json({ name, logoUrl: cached.logo_url, cached: true, stale: true });
    res.status(502).json({ error: `Failed to fetch logo: ${err.message}` });
  }
});

// GET /api/scrape/standings?league=Premier League&season=2025-26
router.get('/standings', async (req, res) => {
  const league = (req.query.league || '').trim();
  const season = (req.query.season || '').trim();
  if (!league || !season) return res.status(400).json({ error: 'league and season are required' });

  const cacheKey = `${league}::${season}`;
  const { rows } = await pool.query('SELECT rows_json, fetched_at FROM standings_cache WHERE cache_key = $1', [cacheKey]);
  const cached = rows[0];
  if (cached && Date.now() - Number(cached.fetched_at) < STANDINGS_CACHE_TTL_MS) {
    return res.json({ league, season, standings: JSON.parse(cached.rows_json), cached: true });
  }

  try {
    const standings = await fetchLeagueStandings(league, season);
    await pool.query(
      `INSERT INTO standings_cache (cache_key, rows_json, fetched_at) VALUES ($1,$2,$3)
       ON CONFLICT (cache_key) DO UPDATE SET rows_json = excluded.rows_json, fetched_at = excluded.fetched_at`,
      [cacheKey, JSON.stringify(standings), Date.now()]
    );
    res.json({ league, season, standings, cached: false });
  } catch (err) {
    if (cached) return res.json({ league, season, standings: JSON.parse(cached.rows_json), cached: true, stale: true });
    res.status(502).json({ error: `Failed to fetch standings: ${err.message}` });
  }
});

export default router;
