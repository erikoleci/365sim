import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';

// Re-implements the table-parsing portion of fetchStandingsFromWikipedia
// as a pure function so the parsing logic itself is unit-testable without
// hitting Wikipedia's live network.
function parseStandingsTable(html) {
  const $ = cheerio.load(html);
  const table = $('table.wikitable').first();
  if (!table.length) return [];
  const headers = table.find('tr').first().find('th').map((_, el) => $(el).text().trim()).get();
  const rows = [];
  table.find('tr').slice(1).each((_, tr) => {
    const cells = $(tr).find('td').map((__, td) => $(td).text().trim()).get();
    if (cells.length === 0) return;
    const row = {};
    headers.forEach((h, i) => { row[h || `col${i}`] = cells[i] ?? null; });
    rows.push(row);
  });
  return rows;
}

const SAMPLE_TABLE = `
  <table class="wikitable">
    <tr><th>Pos</th><th>Team</th><th>Pts</th></tr>
    <tr><td>1</td><td>Arsenal</td><td>70</td></tr>
    <tr><td>2</td><td>Liverpool</td><td>68</td></tr>
  </table>
`;

describe('wikipedia standings table parser', () => {
  it('parses header + rows into objects keyed by header text', () => {
    const rows = parseStandingsTable(SAMPLE_TABLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Pos: '1', Team: 'Arsenal', Pts: '70' });
    expect(rows[1].Team).toBe('Liverpool');
  });

  it('returns an empty array when there is no wikitable', () => {
    expect(parseStandingsTable('<p>no table here</p>')).toEqual([]);
  });

  it('skips rows with no td cells (e.g. a stray header-only row)', () => {
    const html = `
      <table class="wikitable">
        <tr><th>Pos</th><th>Team</th></tr>
        <tr><th colspan="2">Group A</th></tr>
        <tr><td>1</td><td>Arsenal</td></tr>
      </table>`;
    expect(parseStandingsTable(html)).toEqual([{ Pos: '1', Team: 'Arsenal' }]);
  });
});
