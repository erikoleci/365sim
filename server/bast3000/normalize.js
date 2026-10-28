// Pure converter: one match-detail response of the bast3000 feed -> the match / market shape the app
// uses (same as the London365 provider: markets with options { id, name, odds }). It does no network
// access and touches no database; fetching and storing are separate steps.
//
// Response shape (from a real capture):
//   ndeshja.match.det.m   { ndeshje_id, home, away, data: "2026-10-28T18:30:00", kampionati, sport_id_rel, ... }
//   kuotat.nd.n[]         market groups: { grp_id_rel, grpName, rubrika (market name), cat, odds.odd.o[] }
//   odds.odd.o[]          { koefi (price), koefi_id, vlere (option name), grp_detail_id_rel, haGol (handicap) }
// The feed is XML-derived JSON: a single child arrives as an object, several as an array.

import { isoFromWholeDate } from '../london365/clock.js';

const SUSPENDED_PRICE_THRESHOLD = 1.01; // same rule as server/oddsUtils.js

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function normalizeMatchDetail(json) {
  const m = json?.ndeshja?.match?.det?.m;
  if (!m || m.ndeshje_id == null) return null;

  // Kickoff times are Central European wall-clock time; isoFromWholeDate converts them to UTC.
  const startTime = isoFromWholeDate(m.data);
  if (!startTime) return null;

  const id = `bast3000-${m.ndeshje_id}`;
  const markets = [];
  for (const group of asArray(json?.kuotat?.nd?.n)) {
    const name = clean(group?.rubrika);
    if (!name || group?.grp_id_rel == null) continue;

    const options = [];
    for (const o of asArray(group?.odds?.odd?.o)) {
      const odds = Number.parseFloat(o?.koefi);
      const optionName = clean(o?.vlere);
      if (!Number.isFinite(odds) || odds <= 0 || !optionName || o?.koefi_id == null) continue;
      options.push({
        id: String(o.koefi_id),
        name: optionName,
        odds,
        suspended: odds <= SUSPENDED_PRICE_THRESHOLD,
      });
    }
    if (options.length === 0) continue;

    const category = clean(asArray(group?.cat?.ca?.c)[0]?.category) || 'Main';
    markets.push({
      id: `${id}-${group.grp_id_rel}`,
      name,
      category,
      options,
      suspended: options.every((x) => x.suspended),
    });
  }

  return {
    id,
    externalId: String(m.ndeshje_id),
    homeTeam: clean(m.home),
    awayTeam: clean(m.away),
    league: clean(m.kampionati),
    sportId: String(m.sport_id_rel ?? ''),
    startTime,
    markets,
  };
}
