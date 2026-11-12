// Central team-logo resolver. ONE place decides which crest belongs to a team name:
// TeamLogo (components/) is the only caller in the UI.
//
// The collection is local (public/team-logos/, built by scripts/build-team-logos.mjs) and an
// index.json maps a normalised team key -> file(s). The index is fetched once, lazily, and every
// lookup afterwards is a Map hit. The feed gives team NAMES (no stable team id), so the key is the
// normalised name; an exact-key match is required (no fuzzy matching: a wrong crest is worse than
// the neutral placeholder). Aliases below cover the names providers commonly use.
import { teamKey } from './teamLogoKey.js';
import { COUNTRY_TOKEN_LABELS } from './leagueGrouping';

interface LogoIndex { v: number; files: Record<string, 1>; byKey: Record<string, string[]> }

const BASE = `${(import.meta as any).env?.BASE_URL ?? '/'}team-logos/`;

// alias key -> candidate keys in the index (tried in order). Keys are teamKey() output.
// Add a line here for any club the feed spells differently from the collection.
export const TEAM_ALIASES: Record<string, string[]> = {
  'man united': ['manchester united'], 'man utd': ['manchester united'], 'manchester utd': ['manchester united'],
  'man city': ['manchester city'], 'spurs': ['tottenham hotspur', 'tottenham'],
  'tottenham': ['tottenham hotspur', 'tottenham'], 'wolves': ['wolverhampton wanderers'],
  'newcastle': ['newcastle united', 'newcastle'], 'west ham': ['west ham united', 'west ham'],
  'brighton': ['brighton and hove albion', 'brighton'], 'nottm forest': ['nottingham forest'],
  'nott m forest': ['nottingham forest'], 'leeds': ['leeds united'], 'leicester city': ['leicester'],
  'sheffield utd': ['sheffield united'], 'sheffield wed': ['sheffield wednesday'], 'qpr': ['queens park rangers'],
  'inter': ['inter milan', 'inter'], 'internazionale': ['inter milan', 'inter'], 'ac milan': ['milan'],
  'milan': ['milan'], 'atalanta': ['atalanta bc', 'atalanta'], 'fiorentina': ['acf fiorentina', 'fiorentina'],
  'verona': ['hellas verona'], 'roma': ['roma'],
  'atletico madrid': ['atletico madrid'], 'atl madrid': ['atletico madrid'], 'ath madrid': ['atletico madrid'],
  'athletic bilbao': ['athletic club', 'athletic bilbao'], 'ath bilbao': ['athletic club', 'athletic bilbao'],
  'betis': ['real betis', 'real betis balompie'], 'celta': ['celta vigo'], 'celta de vigo': ['celta vigo'],
  'alaves': ['deportivo alaves'], 'rayo': ['rayo vallecano'], 'sociedad': ['real sociedad'],
  'bayern': ['bayern munchen', 'bayern munich'], 'bayern munich': ['bayern munchen', 'bayern munich'],
  'dortmund': ['borussia dortmund'], 'b dortmund': ['borussia dortmund'],
  'leverkusen': ['bayer 04 leverkusen', 'bayer leverkusen'], 'bayer leverkusen': ['bayer 04 leverkusen', 'bayer leverkusen'],
  'rb leipzig': ['rb leipzig'], 'leipzig': ['rb leipzig'],
  'monchengladbach': ['borussia monchengladbach'], 'gladbach': ['borussia monchengladbach'],
  'm gladbach': ['borussia monchengladbach'], 'b monchengladbach': ['borussia monchengladbach'],
  'frankfurt': ['eintracht frankfurt'], 'eintracht frankfurt': ['eintracht frankfurt'],
  'mainz': ['1fsv mainz 05', 'mainz 05'], 'mainz 05': ['1fsv mainz 05', 'mainz 05'],
  'koln': ['1fc koln'], 'cologne': ['1fc koln'], 'fc koln': ['1fc koln'],
  'union berlin': ['1 union berlin', 'union berlin'], 'hoffenheim': ['tsg hoffenheim', 'tsg 1899 hoffenheim', 'hoffenheim'],
  'heidenheim': ['1 heidenheim', '1fc heidenheim', 'heidenheim'], 'stuttgart': ['vfb stuttgart', 'stuttgart'],
  'bremen': ['werder bremen'], 'wolfsburg': ['vfl wolfsburg', 'wolfsburg'], 'augsburg': ['augsburg'],
  'psg': ['paris saint germain', 'paris saint germain psg', 'psg'], 'paris sg': ['paris saint germain', 'paris saint germain psg', 'psg'],
  'paris saint germain': ['paris saint germain', 'paris saint germain psg', 'psg'],
  'marseille': ['olympique marseille', 'marseille'], 'lyon': ['olympique lyonnais', 'olympique lyon', 'lyon'],
  'lille': ['losc lille', 'lille'], 'monaco': ['monaco'], 'st etienne': ['saint etienne'],
  'ajax': ['ajax amsterdam', 'ajax'], 'psv': ['psv eindhoven'], 'feyenoord': ['feyenoord rotterdam', 'feyenoord'],
  'benfica': ['sl benfica', 'benfica'], 'sporting': ['sporting cp'], 'sporting lisbon': ['sporting cp'],
  'porto': ['porto'], 'club brugge': ['club brugge', 'brugge'], 'brugge': ['club brugge', 'brugge'],
  'salzburg': ['red bull salzburg', 'salzburg'], 'rb salzburg': ['red bull salzburg', 'salzburg'],
  'crvena zvezda': ['red star belgrade', 'crvena zvezda', 'red star'], 'red star belgrade': ['red star belgrade', 'crvena zvezda'],
  'shakhtar': ['shakhtar donetsk', 'shakhtar'], 'dynamo kiev': ['dynamo kyiv'], 'dinamo kiev': ['dynamo kyiv'],
  'slavia prague': ['slavia prague', 'slavia praha'], 'sparta prague': ['sparta prague', 'sparta praha'],
  'copenhagen': ['f c copenhagen', 'copenhagen'], 'young boys': ['bsc young boys', 'young boys'],
  'olympiacos': ['olympiacos piraeus', 'olympiacos'], 'olympiakos': ['olympiacos piraeus', 'olympiacos'],
  'paok': ['paok thessaloniki', 'paok'], 'besiktas': ['besiktas jk', 'besiktas'],
};

let index: LogoIndex | null = null;
let loading: Promise<void> | null = null;
let failedAt = 0; // when the last attempt failed; a new attempt is allowed after RETRY_AFTER_MS
const RETRY_AFTER_MS = 15_000;
const listeners = new Set<() => void>();
const cache = new Map<string, string | null>();

// "Anglia" -> "england": the country group of the league, used ONLY to pick between two clubs
// that share a name in different countries.
const FOLDER_BY_LABEL: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [token, label] of Object.entries(COUNTRY_TOKEN_LABELS)) {
    const folder = ({ epl: 'england', holland: 'netherlands', ireland: 'republic-of-ireland', czech: 'czech-republic', 'bosnia-herzegovina': 'bosnia-and-herzegovina' } as Record<string, string>)[token] ?? token;
    out[label] ??= folder;
  }
  return out;
})();

// Without a country hint, a name shared by two countries resolves to the more prominent league.
const COUNTRY_PRIORITY = ['england', 'spain', 'italy', 'germany', 'france', 'portugal', 'netherlands', 'belgium', 'turkey', 'scotland', 'greece'];

export function loadTeamLogoIndex(): Promise<void> {
  if (index) return Promise.resolve();
  if (loading) return loading;
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve();
  loading = fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data: LogoIndex) => {
      // A page that answers 200 but is not the index (an error page, a cached HTML shell) is a failure too.
      if (!data || typeof data !== 'object' || !data.byKey || !data.files) throw new Error('bad index');
      index = data; failedAt = 0; cache.clear();
    })
    .catch(() => {
      failedAt = Date.now(); // no index for now -> placeholders; tried again later, not only after a reload
      if (typeof window !== 'undefined') setTimeout(() => { void loadTeamLogoIndex(); }, RETRY_AFTER_MS + 100);
    })
    .finally(() => { loading = null; listeners.forEach((fn) => fn()); });
  return loading;
}

export const isTeamLogoIndexReady = (): boolean => index !== null;
export function subscribeTeamLogoIndex(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** URL of the local crest for a team, or null when the collection has none. Pure lookup, memoised. */
export function resolveTeamLogo(name: string, country?: string | null): string | null {
  if (!index || !name) return null;
  const folderHint = country ? FOLDER_BY_LABEL[country] ?? null : null;
  const memo = `${folderHint ?? ''}|${name}`;
  const hit = cache.get(memo);
  if (hit !== undefined) return hit;

  const key = teamKey(name);
  let url: string | null = null;
  for (const candidate of [key, ...(TEAM_ALIASES[key] ?? [])]) {
    const files = index.byKey[candidate];
    if (!files || !files.length) continue;
    let file: string | undefined = files.length === 1 ? files[0] : undefined;
    if (!file && folderHint) file = files.find((f) => f.startsWith(`${folderHint}/`));
    if (!file) {
      for (const c of COUNTRY_PRIORITY) { file = files.find((f) => f.startsWith(`${c}/`)); if (file) break; }
    }
    if (file) { url = BASE + file; break; }
  }
  cache.set(memo, url);
  return url;
}

// Test hook: lets unit tests inject an index without fetch.
export function __setTeamLogoIndexForTests(next: LogoIndex | null): void { index = next; failedAt = 0; loading = null; cache.clear(); }
