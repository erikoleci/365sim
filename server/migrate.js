// Lightweight versioned-migration runner.
//
// Why this exists alongside db.js's initDb(): initDb() uses idempotent
// `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
// statements, which work correctly but give no reviewable, numbered history
// of "what changed and when" the way a real migrations/ directory does --
// that gap was a real finding in the production-readiness audit. Rather
// than risk regressions by ripping out and replaying every past schema
// change through a new system, this runner ONLY governs migrations added
// FROM NOW ON (see migrations/0001_baseline.sql): it tracks which
// numbered .sql files in migrations/ have been applied to this database, in
// a `schema_migrations` table, and applies any new ones in filename order,
// each inside its own transaction.
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

export async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    );
  `);

  let files;
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return { applied: [] }; // no migrations/ dir yet — nothing to do
    throw err;
  }

  const { rows: appliedRows } = await pool.query('SELECT filename FROM schema_migrations');
  const alreadyApplied = new Set(appliedRows.map((r) => r.filename));

  const applied = [];
  for (const filename of files) {
    if (alreadyApplied.has(filename)) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)', [filename, Date.now()]);
      await client.query('COMMIT');
      applied.push(filename);
      console.log(`[migrate] applied ${filename}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] FAILED applying ${filename}:`, err.message);
      throw err; // fail startup rather than boot with a half-applied/unknown schema
    } finally {
      client.release();
    }
  }

  return { applied };
}
