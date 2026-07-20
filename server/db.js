import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const db = new Database(path.join(dataDir, 'betsim.db'));

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'USER',
  avatar TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches_cache (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  start_time TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  result_home INTEGER,
  result_away INTEGER,
  settled_at INTEGER,
  live_home_score INTEGER,
  live_away_score INTEGER
);

CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  stake REAL NOT NULL,
  total_odds REAL NOT NULL,
  potential_return REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bet_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bet_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  match_home TEXT NOT NULL,
  match_away TEXT NOT NULL,
  market_id TEXT NOT NULL,
  market_name TEXT NOT NULL,
  selection_id TEXT NOT NULL,
  selection_name TEXT NOT NULL,
  odds REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  FOREIGN KEY (bet_id) REFERENCES bets(id)
);

-- Small generic key-value store for state that must survive process restarts
-- and redeploys (e.g. The Odds API refresh throttling / remaining-credits
-- tracking) — without this, every redeploy wiped in-memory throttle state
-- and re-triggered a full-cost refresh of every league.
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Defensive migration: CREATE TABLE IF NOT EXISTS above does nothing for a
// database that already existed before these columns were added. Adding
// them again on a fresh DB just throws "duplicate column", which we ignore.
for (const col of ['live_home_score INTEGER', 'live_away_score INTEGER']) {
  try {
    db.exec(`ALTER TABLE matches_cache ADD COLUMN ${col}`);
  } catch {
    // already exists — fine
  }
}

// Seed test accounts if the table is empty. These are for LOCAL TESTING
// ONLY — weak, predictable credentials. Never deploy this seed as-is to a
// public/production environment; change or remove it first.
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const insertUser = db.prepare(
    `INSERT INTO users (id, name, username, password_hash, balance, role, avatar, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertUser.run('admin-1', 'Administrator', 'root', bcrypt.hashSync('root', 10), 100000, 'ADMIN', '', Date.now());
  insertUser.run('user-1', 'Test User', 'user', bcrypt.hashSync('user', 10), 1000, 'USER', '', Date.now());

  console.log('Seeded TEST accounts (local use only):');
  console.log('  admin -> username: root / password: root');
  console.log('  user  -> username: user / password: user');
  console.log('WARNING: these are weak credentials for local testing — do not use in production.');
}

export function getKV(key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setKV(key, value) {
  db.prepare(
    `INSERT INTO kv_store (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value));
}

export default db;
