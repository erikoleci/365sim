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

// Most free-tier hosted Postgres providers (Neon, Supabase, Render) require
// SSL but use certs that Node's default TLS validation doesn't recognize as
// a "known" CA chain in every environment — rejectUnauthorized:false is the
// standard, safe-enough setting for this (the connection itself is still
// encrypted; this only skips CA verification, appropriate for a small app
// connecting to a provider-managed database over its documented connection
// string).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export async function initDb() {
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

    -- Small generic key-value store for state that must survive process
    -- restarts/redeploys (API-Football refresh throttling, remaining-quota
    -- tracking, etc).
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Audit trail of every admin action (settlement, credit adjustments,
    -- password resets, user deletion, manual bet-leg overrides). Nothing is
    -- ever deleted from this table.
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT,
      created_at BIGINT NOT NULL
    );
  `);

  // Seed test accounts if the table is empty. These are for LOCAL TESTING
  // ONLY — weak, predictable credentials. Change or remove before letting
  // real users in.
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
