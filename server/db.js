import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error(
    'FATAL: DATABASE_URL is not set. This app now uses PostgreSQL (e.g. a free ' +
    'Neon.tech database) instead of a local SQLite file, so data survives ' +
    'redeploys. Set DATABASE_URL in your environment before starting the server.'
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export async function initDb() {
  await pool.query('SELECT 1');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'USER',
      avatar TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS matches_cache (
      id TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      start_time TEXT NOT NULL,
      status TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      fetched_at BIGINT NOT NULL,
      result_home INTEGER,
      result_away INTEGER,
      settled_at BIGINT,
      live_home_score INTEGER,
      live_away_score INTEGER
    );

    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      stake DOUBLE PRECISION NOT NULL,
      total_odds DOUBLE PRECISION NOT NULL,
      potential_return DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bet_selections (
      id SERIAL PRIMARY KEY,
      bet_id TEXT NOT NULL REFERENCES bets(id),
      match_id TEXT NOT NULL,
      match_home TEXT NOT NULL,
      match_away TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_name TEXT NOT NULL,
      selection_id TEXT NOT NULL,
      selection_name TEXT NOT NULL,
      odds DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING'
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS casino_rounds (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      game TEXT NOT NULL,
      stake DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      state TEXT,
      result TEXT,
      payout DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      resolved_at BIGINT
    );

    -- Odds Engine: every time a selection's odds change, one row here.
    -- Never overwritten — this is the audit trail for "why did the price
    -- move" (auto refresh vs manual admin override) that Risk/Trading
    -- needs, and what powers an odds-movement chart in the UI.
    CREATE TABLE IF NOT EXISTS odds_history (
      id SERIAL PRIMARY KEY,
      match_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      selection_id TEXT NOT NULL,
      old_odds DOUBLE PRECISION,
      new_odds DOUBLE PRECISION NOT NULL,
      changed_by TEXT NOT NULL DEFAULT 'SYSTEM',
      reason TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odds_history_match ON odds_history (match_id, created_at DESC);

    -- Live Match Engine: append-only feed of in-match events (goal, card,
    -- substitution, VAR, corner...). Powers the match timeline and drives
    -- "market suspend for N seconds after a goal".
    CREATE TABLE IF NOT EXISTS match_events (
      id SERIAL PRIMARY KEY,
      match_id TEXT NOT NULL,
      minute INTEGER,
      type TEXT NOT NULL,
      team TEXT,
      player TEXT,
      detail TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events (match_id, created_at);

    -- Live in-play stats snapshot per match (one row per match, overwritten
    -- on each poll) — possession/shots/corners/xG for the live stats panel.
    CREATE TABLE IF NOT EXISTS live_statistics (
      match_id TEXT PRIMARY KEY,
      minute INTEGER,
      home_score INTEGER DEFAULT 0,
      away_score INTEGER DEFAULT 0,
      possession_home INTEGER,
      possession_away INTEGER,
      shots_home INTEGER,
      shots_away INTEGER,
      shots_on_target_home INTEGER,
      shots_on_target_away INTEGER,
      corners_home INTEGER,
      corners_away INTEGER,
      cards_home INTEGER,
      cards_away INTEGER,
      xg_home DOUBLE PRECISION,
      xg_away DOUBLE PRECISION,
      updated_at BIGINT NOT NULL
    );

    -- Cache for the public Wikipedia scraper (server/scrapers/wikipedia.js)
    -- so it hits Wikipedia's infra rarely, not on every page view.
    CREATE TABLE IF NOT EXISTS logo_cache (
      name TEXT PRIMARY KEY,
      logo_url TEXT,
      fetched_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS standings_cache (
      cache_key TEXT PRIMARY KEY,
      rows_json TEXT NOT NULL,
      fetched_at BIGINT NOT NULL
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c === 0) {
    await pool.query(
      `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8), ($9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        'admin-1', 'Administrator', 'root', bcrypt.hashSync('root', 10), 100000, 'ADMIN', '', Date.now(),
        'user-1', 'Test User', 'user', bcrypt.hashSync('user', 10), 1000, 'USER', '', Date.now(),
      ]
    );
    console.log('Seeded TEST accounts (local use only):');
    console.log('  admin -> username: root / password: root');
    console.log('  user  -> username: user / password: user');
    console.log('WARNING: these are weak credentials for local testing — do not use in production.');
  }
}

export async function getKV(key, fallback = null) {
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  if (!rows[0]) return fallback;
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return fallback;
  }
}

export async function setKV(key, value) {
  await pool.query(
    `INSERT INTO kv_store (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)]
  );
}

export default pool;
