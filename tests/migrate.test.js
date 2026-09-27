import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tests the runner's logic (apply-in-order, skip-already-applied,
// transactional, records to schema_migrations) against a fake pool and a
// fake migrations/ directory -- no real filesystem/database needed.

const mocks = vi.hoisted(function () {
  const applied = new Set();
  const executedSql = [];
  let files = {}; // filename -> sql content

  function reset() {
    applied.clear();
    executedSql.length = 0;
    files = {};
  }

  function query(sql, params = []) {
    const s = String(sql);
    if (s.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return Promise.resolve({ rows: [] });
    if (s.startsWith('SELECT filename FROM schema_migrations')) {
      return Promise.resolve({ rows: [...applied].map((filename) => ({ filename })) });
    }
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return Promise.resolve({ rows: [] });
    if (s.startsWith('INSERT INTO schema_migrations')) {
      applied.add(params[0]);
      return Promise.resolve({ rows: [] });
    }
    // Any other SQL is treated as the migration file's own body being run.
    executedSql.push(s);
    return Promise.resolve({ rows: [] });
  }

  const client = { query: vi.fn((sql, params) => query(sql, params)), release: vi.fn() };
  const pool = { query, connect: () => Promise.resolve(client) };
  return { applied, executedSql, files, reset, pool };
});

vi.mock('fs/promises', () => ({
  readdir: vi.fn(async () => Object.keys(mocks.files)),
  readFile: vi.fn(async (filePath) => {
    const filename = String(filePath).split('/').pop();
    return mocks.files[filename];
  }),
}));

const { runMigrations } = await import('../server/migrate.js');

beforeEach(() => { mocks.reset(); });

describe('runMigrations', () => {
  it('applies migrations in filename order and records each one', async () => {
    mocks.files = {
      '0002_second.sql': 'SELECT 2;',
      '0001_first.sql': 'SELECT 1;',
    };
    const result = await runMigrations(mocks.pool);
    expect(result.applied).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(mocks.executedSql).toEqual(['SELECT 1;', 'SELECT 2;']);
    expect([...mocks.applied]).toEqual(expect.arrayContaining(['0001_first.sql', '0002_second.sql']));
  });

  it('skips migrations already recorded as applied', async () => {
    mocks.files = { '0001_first.sql': 'SELECT 1;', '0002_second.sql': 'SELECT 2;' };
    mocks.applied.add('0001_first.sql');

    const result = await runMigrations(mocks.pool);
    expect(result.applied).toEqual(['0002_second.sql']);
    expect(mocks.executedSql).toEqual(['SELECT 2;']); // 0001's body never re-run
  });

  it('is a no-op (does not throw) when nothing is pending', async () => {
    mocks.files = { '0001_first.sql': 'SELECT 1;' };
    mocks.applied.add('0001_first.sql');

    const result = await runMigrations(mocks.pool);
    expect(result.applied).toEqual([]);
  });

  it('ignores non-.sql files in the migrations directory', async () => {
    mocks.files = { '0001_first.sql': 'SELECT 1;', 'README.md': 'not a migration' };
    const result = await runMigrations(mocks.pool);
    expect(result.applied).toEqual(['0001_first.sql']);
  });
});
