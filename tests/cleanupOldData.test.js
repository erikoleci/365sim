import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for a real production bug: cleanupOldData's
// matches_cache DELETE referenced `updated_at`, a column that has never
// existed on that table (see server/db.js's own CREATE TABLE for
// matches_cache — only fetched_at/settled_at). The query failed every
// single run ("column \"updated_at\" does not exist"), so finished matches
// were never actually pruned. This doesn't need a real database to catch —
// just asserting the query text never reintroduces the bad column name.

const queries = [];
const mocks = vi.hoisted(function () {
  return {
    query: vi.fn((sql) => {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
  };
});

vi.mock('pg', function () {
  return {
    default: {
      Pool: function () {
        return { query: mocks.query, on: vi.fn() };
      },
    },
  };
});

beforeEach(function () {
  mocks.query.mockClear();
  queries.length = 0;
  mocks.query.mockImplementation((sql) => {
    queries.push(String(sql));
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

describe('cleanupOldData', function () {
  it('never references the non-existent matches_cache.updated_at column', async function () {
    const { cleanupOldData } = await import('../server/db.js');
    await cleanupOldData();
    const matchesCacheDelete = queries.find((q) => q.includes('DELETE FROM matches_cache'));
    expect(matchesCacheDelete).toBeDefined();
    expect(matchesCacheDelete).not.toMatch(/\bupdated_at\b/);
    expect(matchesCacheDelete).toMatch(/\bsettled_at\b/);
  });
});
