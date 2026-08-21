// Public-data scraper: Wikipedia / Wikimedia Commons only.
//
// Scope, deliberately: this pulls team/competition LOGOS and STANDINGS/
// FIXTURES TABLES from Wikipedia — content that is public, typically
// CC-BY-SA licensed (article text) or fair-use/logo-exception (club crests
// hosted on Commons/Wikipedia specifically for identification use), and
// carries no bookmaker ToS or anti-bot protection to defeat.
//
// This deliberately does NOT scrape odds from any bookmaker site. Odds are
// a bookmaker's proprietary commercial output (trading desk cost, ToS-
// protected, anti-bot-protected) — scraping them for a competing product is
// a real legal exposure, not just a technical challenge. Use a licensed
// odds API (Sportmonks/API-Football/The Odds API, already integrated in
// this repo) for odds instead.
//
// Etiquette: identify with a real User-Agent (Wikimedia requires this and
// will rate-limit/block generic ones), and keep request volume low — this
// hits Wikipedia's live infra, not a dedicated data API.

import * as cheerio from 'cheerio';

const USER_AGENT = '365sim-scraper/1.0 (contact: set-your-email-here@example.com)';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';

async function wikiFetch(params) {
  const url = `${WIKI_API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Wikipedia API error ${res.status} for ${url}`);
  return res.json();
}

// Resolve a team/competition name to its Wikipedia page title (handles
// "Man City" -> "Manchester City F.C." style mismatches via search).
export async function resolvePageTitle(query) {
  const data = await wikiFetch({ action: 'query', list: 'search', srsearch: query, srlimit: 1 });
  const hit = data?.query?.search?.[0];
  return hit ? hit.title : null;
}

// Team/competition crest: pulls the page's infobox image (the crest shown
// in the article's top-right infobox), which is how Wikipedia itself
// displays official logos under its non-free-logo policy.
export async function fetchLogoUrl(teamOrCompetitionName) {
  const title = await resolvePageTitle(teamOrCompetitionName);
  if (!title) return null;

  const data = await wikiFetch({
    action: 'query',
    prop: 'pageimages',
    titles: title,
    pithumbsize: 300,
  });
  const pages = data?.query?.pages || {};
  const page = Object.values(pages)[0];
  return page?.thumbnail?.url || null;
}

// Standings table scraper: parses the first sortable wikitable on a
// league-season page (e.g. "2025-26 Premier League") into structured rows.
// Wikipedia's standings tables are consistently formatted across leagues,
// which is what makes this generic rather than one-off per competition.
export async function fetchStandingsFromWikipedia(pageTitle) {
  const html = await wikiFetch({ action: 'parse', page: pageTitle, prop: 'text' });
  const rawHtml = html?.parse?.text?.['*'];
  if (!rawHtml) throw new Error(`Wikipedia page not found: ${pageTitle}`);

  const $ = cheerio.load(rawHtml);
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

// Convenience wrapper: given a league name + season, guesses the standard
// Wikipedia page-title pattern ("2025-26 Premier League") and fetches it.
// Falls back to search-based resolution if the guessed title doesn't exist.
export async function fetchLeagueStandings(leagueName, seasonLabel) {
  const guessedTitle = `${seasonLabel} ${leagueName}`;
  try {
    return await fetchStandingsFromWikipedia(guessedTitle);
  } catch {
    const resolved = await resolvePageTitle(`${seasonLabel} ${leagueName} season`);
    if (!resolved) return [];
    return fetchStandingsFromWikipedia(resolved);
  }
}
