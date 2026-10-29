import type { Market, MarketOption } from '../types';

// Groups the provider's markets for the match page the way a bookmaker lays them out: ONE table per
// kind of bet instead of one box per line.
//
//   Total Gola            Lart   Poshtë          (over / under: one row per line, also corners and cards)
//     0.5                 1.07   9.00
//     1.5                 1.30   3.40
//
//   Gara e Korneve           1     X     2       (race to N corners: one row per N)
//     3                    2.25  34.00  1.57
//
//   Handikap Aziatik         1          2        (asian handicap: one row per line)
//     -0.5                 1.90       1.90
//
// The provider sends these either as one market with many lines or as many markets with the SAME name
// and one line each (as with "Gara e Korneve" 3 / 5 / 7 / 9); both end up in the same table. Every cell
// keeps the id of the market it really belongs to, so betting, the slip and the odds arrows work as
// before. Markets that are none of these are returned untouched.

export interface TableCell {
  marketId: string;
  option: MarketOption;
  // Short text shown in front of the odds when the column alone does not say what it is (the signed
  // line of an asian handicap: "-0.5" / "+0.5"). Not set for over / under and race cells.
  label?: string;
}

export interface TableRow {
  label: string; // the line / N shown in the first column ('' when the row has no label column)
  cells: (TableCell | null)[];
}

export interface TableSection {
  kind: 'ou' | 'race' | 'handicap';
  key: string;
  title: string;
  headers: string[]; // one per cell column
  hasLabelColumn: boolean;
  rows: TableRow[];
  // Options of the same markets that do not fit the table (e.g. "Sakte 10" next to the over / under
  // lines). Shown as a plain grid under it.
  extras: TableCell[];
}

export type MarketBlock = { type: 'market'; market: Market } | { type: 'table'; section: TableSection };

const norm = (s: string): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/−/g, '-').toLowerCase().replace(/\s+/g, ' ').trim();

const num = (s: string): number => parseFloat(s.replace(',', '.'));
const lineText = (s: string): string => s.replace(',', '.');

interface OverUnder { over: boolean; word: string; line: number; text: string }
// "Lart 2.5" / "Poshte 2.5" / "Mbi 2.5" / "Nën 2.5" / "Over 2.5" / "Under-2.5"
export function parseOverUnderOption(name: string): OverUnder | null {
  const m = norm(name).match(/^(lart|mbi|over|poshte|nen|under)[\s-]*(\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const line = num(m[2]);
  if (!Number.isFinite(line)) return null;
  const word = String(name).trim().split(/[\s-]/)[0] || m[1];
  return { over: /^(lart|mbi|over)$/.test(m[1]), word, line, text: lineText(m[2]) };
}

export type RaceSide = 'HOME' | 'AWAY' | 'NONE';
// "Gara e Korneve" option -> side + N. The table of the provider has rows = the line (3 / 5 / 7 / 9) and
// columns = home team | X | away team, so every spelling of "side + line" is accepted:
//   "Universidad de Chile 5", "7 Everton de Vina", "X 9", "1 5", "5 - 1", "2|7", "5 X".
// A text that cannot be read with certainty is not guessed (the market stays a plain box).
export function parseRaceOption(text: string, home: string, away: string): { n: number; side: RaceSide } | null {
  let s = norm(text);
  const nh = home ? norm(home) : '';
  const na = away ? norm(away) : '';
  let side: RaceSide | null = null;
  const inH = !!nh && s.includes(nh);
  const inA = !!na && s.includes(na);
  if (inH && inA) return null;
  if (inH) { side = 'HOME'; s = s.replace(nh, ' '); } else if (inA) { side = 'AWAY'; s = s.replace(na, ' '); }
  const tokens = s.replace(/[|()\-:,]/g, ' ').split(/\s+/).filter(Boolean);
  const isNum = (t: string) => /^\d+$/.test(t);
  const done = (n: number, sd: RaceSide) => (Number.isFinite(n) && n >= 1 ? { n, side: sd } : null);
  if (side) return tokens.length === 1 && isNum(tokens[0]) ? done(Number(tokens[0]), side) : null;
  if (tokens.length !== 2) return null;
  const [a, b] = tokens;
  const asSide = (t: string): RaceSide | null => (t === '1' ? 'HOME' : t === '2' ? 'AWAY' : /^(x|draw|barazim|asnje|neither|none)$/.test(t) ? 'NONE' : null);
  const first = asSide(a) && isNum(b) ? { side: asSide(a) as RaceSide, n: Number(b) } : null; // "1 5" / "X 7"
  const second = asSide(b) && isNum(a) ? { side: asSide(b) as RaceSide, n: Number(a) } : null; // "5 1" / "7 X"
  if (first && second) return null; // "1 2": could be either way round
  const r = first || second;
  return r ? done(r.n, r.side) : null;
}

// "1 -0.5" = home with a -0.5 line, "2 +1" = away with +1 (own side + its line).
export function parseAsianHandicapOption(name: string): { side: 1 | 2; line: number; text: string } | null {
  const m = norm(name).match(/^([12])\s*([+-]?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const line = num(m[2]);
  if (!Number.isFinite(line)) return null;
  return { side: m[1] === '1' ? 1 : 2, line, text: signed(line) };
}

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '0');

type Kind = 'ou' | 'race' | 'handicap';

interface Parsed { kind: Kind; cells: { cell: TableCell; col: number; sort: number; label: string; header?: string }[]; extras: TableCell[] }

function parseMarket(market: Market, home: string, away: string): Parsed | null {
  const name = norm(market.name);
  const options = market.options;
  if (!options.length) return null;

  // over / under lines (at least a pair or several lines; "Sakte N" and the like stay as extras)
  const ou = options.map((o) => ({ o, p: parseOverUnderOption(o.name) }));
  const ouHits = ou.filter((x) => x.p);
  if (ouHits.length >= 2) {
    return {
      kind: 'ou',
      cells: ouHits.map(({ o, p }) => ({ cell: { marketId: market.id, option: o }, col: p!.over ? 0 : 1, sort: p!.line, label: p!.text, header: p!.word })),
      extras: ou.filter((x) => !x.p).map((x) => ({ marketId: market.id, option: x.o })),
    };
  }

  if (/^gara e /.test(name)) {
    const race = options.map((o) => ({ o, p: parseRaceOption(o.name, home, away) }));
    if (race.every((x) => x.p)) {
      return {
        kind: 'race',
        cells: race.map(({ o, p }) => ({ cell: { marketId: market.id, option: o }, col: p!.side === 'HOME' ? 0 : p!.side === 'NONE' ? 1 : 2, sort: p!.n, label: String(p!.n) })),
        extras: [],
      };
    }
  }

  if (/handik|hendik|handicap/.test(name)) {
    const hc = options.map((o) => ({ o, p: parseAsianHandicapOption(o.name) }));
    if (hc.length >= 2 && hc.every((x) => x.p)) {
      return {
        kind: 'handicap',
        // the away line belongs to the row of the opposite home line: "1 -0.5" and "2 +0.5" are one row
        cells: hc.map(({ o, p }) => ({ cell: { marketId: market.id, option: o, label: p!.text }, col: p!.side === 1 ? 0 : 1, sort: p!.side === 1 ? p!.line : -p!.line, label: p!.text })),
        extras: [],
      };
    }
  }
  return null;
}

const COLUMNS: Record<Kind, number> = { ou: 2, race: 3, handicap: 2 };
const DEFAULT_HEADERS: Record<Kind, string[]> = { ou: ['Lart', 'Poshtë'], race: ['1', 'X', '2'], handicap: ['1', '2'] };

export function groupMarkets(markets: Market[], home: string, away: string): MarketBlock[] {
  const blocks: MarketBlock[] = [];
  const sections = new Map<string, { section: TableSection; entries: { col: number; sort: number; label: string; cell: TableCell }[]; headerSet: Set<number> }>();

  for (const market of markets) {
    const parsed = parseMarket(market, home, away);
    if (!parsed) { blocks.push({ type: 'market', market }); continue; }
    const key = `${parsed.kind}|${norm(market.name)}`;
    let group = sections.get(key);
    if (!group) {
      const section: TableSection = {
        kind: parsed.kind, key, title: market.name,
        headers: [...DEFAULT_HEADERS[parsed.kind]], hasLabelColumn: parsed.kind !== 'handicap', rows: [], extras: [],
      };
      group = { section, entries: [], headerSet: new Set() };
      sections.set(key, group);
      blocks.push({ type: 'table', section });
    }
    for (const c of parsed.cells) {
      group.entries.push({ col: c.col, sort: c.sort, label: c.label, cell: c.cell });
      if (c.header && parsed.kind === 'ou' && !group.headerSet.has(c.col)) {
        // header words as the provider spells them (Lart / Poshte, Mbi / Nën, Over / Under)
        group.section.headers[c.col] = c.header;
        group.headerSet.add(c.col);
      }
    }
    group.section.extras.push(...parsed.extras);
  }

  for (const { section, entries } of sections.values()) {
    const cols = COLUMNS[section.kind];
    const rows: { sort: number; row: TableRow }[] = [];
    for (const e of [...entries].sort((a, b) => a.sort - b.sort)) {
      // first row of this line whose slot is still free (a duplicate line gets its own row)
      let target = rows.find((r) => r.sort === e.sort && r.row.cells[e.col] == null);
      if (!target) {
        target = { sort: e.sort, row: { label: section.kind === 'handicap' ? '' : e.label, cells: Array.from({ length: cols }, () => null) } };
        rows.push(target);
      }
      target.row.cells[e.col] = e.cell;
    }
    section.rows = rows.map((r) => r.row);
  }
  return blocks;
}
