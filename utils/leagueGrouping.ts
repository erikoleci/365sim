// League -> country/competition grouping for the LIVE feed and country
// filters, extracted out of App.tsx so this logic (which is pure, data-in
// data-out, no React state) can be unit tested directly instead of only
// being exercised indirectly through the whole app. Behavior is UNCHANGED
// from what previously lived inline in App.tsx -- this is a pure move, not
// a rewrite. See tests/leagueGrouping.test.ts.
//
// Classifies a league by COMPETITION/COUNTRY identity, never by which team
// happens to be playing (e.g. Real Madrid in the Champions League still
// classifies as "Ndërkombëtare", not "Spanja", because the match-detection
// below runs on the league key itself, not on team names).

export const COUNTRY_TOKEN_LABELS: Record<string, string> = {
  epl: 'Anglia', england: 'Anglia', spain: 'Spanja', italy: 'Italia', germany: 'Gjermania',
  france: 'Franca', usa: 'SHBA', brazil: 'Brazil', argentina: 'Argjentinë', portugal: 'Portugali',
  netherlands: 'Holandë', belgium: 'Belgjikë', turkey: 'Turqi', greece: 'Greqi', scotland: 'Skoci',
  switzerland: 'Zvicër', austria: 'Austri', denmark: 'Danimarkë', sweden: 'Suedi', norway: 'Norvegji',
  russia: 'Rusi', poland: 'Poloni', mexico: 'Meksikë', japan: 'Japoni', korea: 'Korea e Jugut',
  china: 'Kinë', australia: 'Australi', chile: 'Kili', colombia: 'Kolumbi', albania: 'Shqipëri',
  croatia: 'Kroaci', serbia: 'Serbi', romania: 'Rumani', ukraine: 'Ukrainë', saudi: 'Arabia Saudite',
  kosovo: 'Kosovë',
  // Extended list so far more countries get a proper Albanian label
  // (and flag, via COUNTRY_TOKEN_ISO below) instead of falling back to a
  // raw title-cased English name.
  iceland: 'Islandë', hungary: 'Hungari', 'czech-republic': 'Republika Çeke', finland: 'Finlandë',
  peru: 'Peru', slovakia: 'Sllovaki', slovenia: 'Slloveni', ireland: 'Irlandë', uruguay: 'Uruguai',
  israel: 'Izrael', bulgaria: 'Bullgari', malaysia: 'Malajzi', belarus: 'Bjellorusi', estonia: 'Estoni',
  'northern-ireland': 'Irlanda e Veriut', wales: 'Uells', malta: 'Maltë',
  'bosnia-herzegovina': 'Bosnjë dhe Hercegovinë', lithuania: 'Lituani', latvia: 'Letoni',
  ecuador: 'Ekuador', luxembourg: 'Luksemburg', 'faroe-islands': 'Ishujt Faroe', georgia: 'Gjeorgji',
  'costa-rica': 'Kosta Rika', 'republic-of-korea': 'Korea e Jugut', armenia: 'Armeni',
  azerbaijan: 'Azerbajxhan', 'united-arab-emirates': 'Emiratet e Bashkuara Arabe', algeria: 'Algjeri',
  egypt: 'Egjipt', 'south-africa': 'Afrika e Jugut', jordan: 'Jordani', kuwait: 'Kuvajt',
  'hong-kong': 'Hong Kongu', 'hong-kong-china': 'Hong Kongu', bahrain: 'Bahrein', qatar: 'Katar', guatemala: 'Guatemalë',
  vietnam: 'Vietnam', 'el-salvador': 'El Salvador', indonesia: 'Indonezi', andorra: 'Andorë',
  bolivia: 'Bolivi', uzbekistan: 'Uzbekistan', montenegro: 'Mali i Zi', 'san-marino': 'San Marino',
  canada: 'Kanada', nicaragua: 'Nikaragua', honduras: 'Honduras', thailand: 'Tajlandë',
  iraq: 'Irak', panama: 'Panama', tanzania: 'Tanzani', botswana: 'Botsvanë', zimbabwe: 'Zimbabve',
  uganda: 'Ugandë', paraguay: 'Paraguai', venezuela: 'Venezuelë', kazakhstan: 'Kazakistan',
  moldova: 'Moldavi', cyprus: 'Qipro', 'northern-cyprus': 'Qipro Veriore',
  india: 'Indi', myanmar: 'Mianmar', nigeria: 'Nigeri', ghana: 'Ganë', kenya: 'Kenia',
  morocco: 'Marok', tunisia: 'Tunizi', iran: 'Iran',
  // Tokens që vijnë nga provider-a të tjerë (api-football etc.) ose në
  // formë pa vizë — pa këto, shtete reale përfundonin te "Të tjera".
  southkorea: 'Korea e Jugut', 'south-korea': 'Korea e Jugut', 'united-states': 'SHBA',
  holland: 'Holandë', czech: 'Republika Çeke', 'saudi-arabia': 'Arabia Saudite',
  'new-zealand': 'Zelanda e Re', singapore: 'Singapor', philippines: 'Filipine',
  lebanon: 'Liban', syria: 'Siri', libya: 'Libi', sudan: 'Sudan', senegal: 'Senegal',
  cameroon: 'Kamerun', 'ivory-coast': 'Bregu i Fildishtë', zambia: 'Zambi',
  mozambique: 'Mozambik', angola: 'Angolë', ethiopia: 'Etiopi', rwanda: 'Ruandë',
  gibraltar: 'Gjibraltar', liechtenstein: 'Lihtenshtajn', macedonia: 'Maqedoni',
  'north-macedonia': 'Maqedonia e Veriut', tajikistan: 'Taxhikistan',
  turkmenistan: 'Turkmenistan', kyrgyzstan: 'Kirgistan', mongolia: 'Mongoli',
  nepal: 'Nepal', bangladesh: 'Bangladesh', pakistan: 'Pakistan', 'sri-lanka': 'Shri Lanka',
  jamaica: 'Xhamajkë', 'dominican-republic': 'Republika Dominikane', cuba: 'Kubë',
  haiti: 'Haiti', belize: 'Belize', suriname: 'Surinam', 'puerto-rico': 'Porto Riko',
};
// ISO 3166-1 alpha-2 code per country token -> converted to a flag emoji
// via regional indicator symbols. This is a clean, deterministic mapping
// (country token -> ISO code -> flag) rather than one icon reused for
// every country, and needs no image assets/network calls.
export const COUNTRY_TOKEN_ISO: Record<string, string> = {
  epl: 'GB', england: 'GB', spain: 'ES', italy: 'IT', germany: 'DE',
  france: 'FR', usa: 'US', brazil: 'BR', argentina: 'AR', portugal: 'PT',
  netherlands: 'NL', belgium: 'BE', turkey: 'TR', greece: 'GR', scotland: 'GB',
  switzerland: 'CH', austria: 'AT', denmark: 'DK', sweden: 'SE', norway: 'NO',
  russia: 'RU', poland: 'PL', mexico: 'MX', japan: 'JP', korea: 'KR',
  china: 'CN', australia: 'AU', chile: 'CL', colombia: 'CO', albania: 'AL',
  croatia: 'HR', serbia: 'RS', romania: 'RO', ukraine: 'UA', saudi: 'SA',
  kosovo: 'XK',
  iceland: 'IS', hungary: 'HU', 'czech-republic': 'CZ', finland: 'FI', peru: 'PE',
  slovakia: 'SK', slovenia: 'SI', ireland: 'IE', uruguay: 'UY', israel: 'IL',
  bulgaria: 'BG', malaysia: 'MY', belarus: 'BY', estonia: 'EE', 'northern-ireland': 'GB',
  wales: 'GB', malta: 'MT', 'bosnia-herzegovina': 'BA', lithuania: 'LT', latvia: 'LV',
  ecuador: 'EC', luxembourg: 'LU', 'faroe-islands': 'FO', georgia: 'GE', 'costa-rica': 'CR',
  armenia: 'AM', azerbaijan: 'AZ', 'united-arab-emirates': 'AE', algeria: 'DZ', egypt: 'EG',
  'south-africa': 'ZA', jordan: 'JO', kuwait: 'KW', 'hong-kong': 'HK', 'hong-kong-china': 'HK', bahrain: 'BH',
  qatar: 'QA', guatemala: 'GT', vietnam: 'VN', 'el-salvador': 'SV', indonesia: 'ID',
  andorra: 'AD', bolivia: 'BO', uzbekistan: 'UZ', montenegro: 'ME', 'san-marino': 'SM',
  canada: 'CA', nicaragua: 'NI', honduras: 'HN', thailand: 'TH', iraq: 'IQ', panama: 'PA',
  tanzania: 'TZ', botswana: 'BW', zimbabwe: 'ZW', uganda: 'UG', paraguay: 'PY',
  venezuela: 'VE', kazakhstan: 'KZ', moldova: 'MD', cyprus: 'CY', 'northern-cyprus': 'CY',
  india: 'IN', myanmar: 'MM', nigeria: 'NG', ghana: 'GH', kenya: 'KE', morocco: 'MA',
  tunisia: 'TN', iran: 'IR',
  southkorea: 'KR', 'south-korea': 'KR', 'united-states': 'US', holland: 'NL',
  czech: 'CZ', 'saudi-arabia': 'SA', 'new-zealand': 'NZ', singapore: 'SG',
  philippines: 'PH', lebanon: 'LB', syria: 'SY', libya: 'LY', sudan: 'SD',
  senegal: 'SN', cameroon: 'CM', 'ivory-coast': 'CI', zambia: 'ZM',
  mozambique: 'MZ', angola: 'AO', ethiopia: 'ET', rwanda: 'RW', gibraltar: 'GI',
  liechtenstein: 'LI', macedonia: 'MK', 'north-macedonia': 'MK', tajikistan: 'TJ',
  turkmenistan: 'TM', kyrgyzstan: 'KG', mongolia: 'MN', nepal: 'NP',
  bangladesh: 'BD', pakistan: 'PK', 'sri-lanka': 'LK', jamaica: 'JM',
  'dominican-republic': 'DO', cuba: 'CU', haiti: 'HT', belize: 'BZ',
  suriname: 'SR', 'puerto-rico': 'PR',
};
const isoToFlagEmoji = (iso: string): string =>
  iso.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
const INTERNATIONAL_TOKENS = new Set(['uefa', 'fifa', 'conmebol', 'concacaf', 'afc', 'caf', 'international']);

// Normalizon emrin e liges per klasifikim: heq aksentet ("Turkiye" ->
// "turkiye"), zevendeson cdo shenje jo-alfanumerike (perfshire mojibake si
// "T??Rkiye" ose "Women???S") me hapesire, dhe kthen shkronja te vogla.
export const normalizeLeagueName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Harta "emer i lexueshem -> token shteti". Shumica e providerve dergojne
// ligat si emra ("Spain La Liga", "Brasileiro Serie B", "M15 Madrid",
// "AFC U20 Asian Cup Qualification") — pa kete harte ato binin te gjitha
// te "Të tjera". Rendi i kontrollit:
//  1) emri i shtetit (ose fjale qe i perkasin vetem atij: "brasileiro",
//     "ekstraklasa", "allsvenskan", qytetet e turnireve M15/W15/Challenger),
//  2) kompeticione kombetare pa emer shteti ne rresht ("Premier League",
//     "Serie A/B/C"...),
//  3) kompeticione nderkombetare (UEFA/FIFA/AFC/ASEAN/FIBA/World Cup/
//     Friendlies) -> grupi "Ndërkombëtare",
//  4) asgje -> "Të tjera".
const NAME_TOKEN_PATTERNS: [RegExp, string][] = [
  // --- 1) Emra shtetesh + fjale unike kombetare + qytete turnish ---
  [/algeria/, 'algeria'],
  [/argentina/, 'argentina'],
  [/armenia/, 'armenia'],
  [/australia|new south wales|npl queensland|sa premier league/, 'australia'],
  [/azerbaijan/, 'azerbaijan'],
  [/belgium|belgian/, 'belgium'],
  [/brazil|brasileiro|copa do brasil|paulista|pernambucano|cearense|goias|amazonense|campeonato brasileiro/, 'brazil'],
  [/bulgaria|plovdiv/, 'bulgaria'],
  [/chile/, 'chile'],
  [/china|zhangjiagang|cba/, 'china'],
  [/colombia/, 'colombia'],
  [/cyprus/, 'cyprus'],
  [/denmark|superligaen/, 'denmark'],
  [/ecuador|ligapro/, 'ecuador'],
  [/egypt|hurghada/, 'egypt'],
  [/england/, 'england'],
  [/estonia|esiliiga/, 'estonia'],
  [/finland|kakkonen|kolmonen/, 'finland'],
  [/france|ligue 1|ligue 2|ligue 3|coupe de france|cap d agde/, 'france'],
  [/georgia/, 'georgia'],
  [/germany|bundesliga|meerbusch|dfb/, 'germany'],
  [/greece/, 'greece'],
  [/hungary|nb i|nb ii|pecs|magyar/, 'hungary'],
  [/iceland/, 'iceland'],
  [/india|mizoram|shillong|sikkim/, 'india'],
  [/indonesia/, 'indonesia'],
  [/iraq/, 'iraq'],
  [/israel|liga alef|liga bet|liga leumit/, 'israel'],
  [/italy|coppa italia|primavera|fiano romano/, 'italy'],
  [/japan/, 'japan'],
  [/jordan/, 'jordan'],
  [/latvia/, 'latvia'],
  [/lithuania|a lyga/, 'lithuania'],
  [/malaysia/, 'malaysia'],
  [/mozambique|mocambola/, 'mozambique'],
  [/myanmar/, 'myanmar'],
  [/netherlands|eredivisie|dutch|holland/, 'netherlands'],
  [/paraguay/, 'paraguay'],
  [/poland|ekstraklasa|iv liga|puchar|szczawno|grodzisk/, 'poland'],
  [/portugal|porto/, 'portugal'],
  [/qatar/, 'qatar'],
  [/romania|buzau|brasov/, 'romania'],
  [/saudi/, 'saudi'],
  [/scotland/, 'scotland'],
  [/serbia|kursumlijska/, 'serbia'],
  [/slovenia/, 'slovenia'],
  [/spain|la liga|laliga|madrid|badalona|copa del rey/, 'spain'],
  [/sweden|allsvenskan/, 'sweden'],
  [/switzerland/, 'switzerland'],
  [/turkey|turkiye|rkiye|tff|super lig/, 'turkey'],
  [/uganda/, 'uganda'],
  [/ukraine/, 'ukraine'],
  [/uruguay/, 'uruguay'],
  [/\busa\b|united states|us open|major league soccer|\bmls\b/, 'usa'],
  [/uzbekistan/, 'uzbekistan'],
  [/vietnam/, 'vietnam'],
  [/wales/, 'wales'],
  [/tanzania|zanzibar/, 'tanzania'],
  [/thailand|nonthaburi/, 'thailand'],
  [/tunisia|monastir/, 'tunisia'],
  [/morocco|casablanca/, 'morocco'],
  [/bahrain/, 'bahrain'],
  [/hong kong/, 'hong-kong-china'],
  // --- 3) Nderkombetare (kontrollohen PARA kompeticioneve kombetare "te
  //     zhveshura" me poshte, sepse "ASEAN Championship Qualifying" perben
  //     fjalen "championship" dhe do perputhej gabimisht me Anglinë nese ky
  //     kontroll do vinte pas — nje kompeticion nderkombetar/rajonal duhet
  //     te fitoje mbi nje fjale te pergjithshme si "championship"/"premier
  //     league" qe shume vende e perdorin per ligen e tyre kombetare.) ---
  [/afc|asian cup|asean|fiba|world cup|world club|club friendlies|europe friendlies|women.{0,4}s friendly|uefa|champions league|europa league|conference league|nations league|intercontinental/, 'international'],
  // --- 2) Kompeticione kombetare pa emer shteti ne rresht ---
  [/premier league|championship|fa cup|efl|league one|league two|development league/, 'england'],
  [/serie a|serie b|serie c/, 'italy'],
  [/segunda division|primera division/, 'spain'],
  [/bundesliga|dfb pokal|regionalliga/, 'germany'],
  [/knvb/, 'netherlands'],
  [/pro league|first division/, 'belgium'],
  [/hnl/, 'croatia'],
  [/superettan/, 'sweden'],
  [/eliteserien/, 'norway'],
  [/veikkausliiga/, 'finland'],
  [/meistriliiga/, 'estonia'],
  [/virsliga/, 'latvia'],
  [/kategoria superiore/, 'albania'],
  [/sleague/, 'singapore'],
  [/prva liga|druga liga|superliga/, 'serbia'],
];

export const leagueCountryToken = (key: string): string | null => {
  if (key === 'soccer_epl') return 'epl';
  if (key === 'oddsapiio_albania_superiore') return 'albania';
  // New LondonPro365 format: l365_<country-slug>__<competition-slug> — the
  // DOUBLE underscore is the unambiguous boundary, so a multi-word
  // country (e.g. "costa-rica", "hong-kong-china") comes through intact
  // instead of being cut down to its first word.
  const dbl = key.match(/^[a-z0-9]+_([a-z0-9-]+)__/)?.[1];
  if (dbl) return dbl;
  // Legacy single-underscore format (older cached rows / other providers).
  const legacy = key.match(/^[a-z0-9]+_([a-z]+)_/)?.[1];
  if (legacy) return legacy;
  // Emra te lexueshem ("Spain La Liga", "M15 Madrid", "Brasileiro Serie B",
  // "AFC U20 Asian Cup Qualification") — klasifikohen sipas hartes me lart.
  const norm = normalizeLeagueName(key);
  const hit = NAME_TOKEN_PATTERNS.find(([re]) => re.test(norm));
  return hit ? hit[1] : null;
};
export const leagueCountry = (key: string): string => {
  const token = leagueCountryToken(key);
  if (!token || token === 'other') return 'Të tjera';
  if (INTERNATIONAL_TOKENS.has(token)) return 'Ndërkombëtare';
  if (COUNTRY_TOKEN_LABELS[token]) return COUNTRY_TOKEN_LABELS[token];
  // Unknown country not yet in our Albanian dictionary — still show its
  // own real name (dash-slug -> Title Case Words) instead of "Të tjera".
  return token.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};
// Flag for a country GROUP NAME (as returned by leagueCountry above) —
// looks up the underlying ISO code by reverse-mapping the label. Falls
// back to a globe icon for "Ndërkombëtare"/"Të tjera" (no single country
// flag applies) instead of forcing a flag onto non-country groups.
export const countryFlag = (countryName: string): string => {
  if (countryName === 'Ndërkombëtare') return '🌍';
  if (countryName === 'Të tjera') return '🏳️';
  const token = Object.keys(COUNTRY_TOKEN_LABELS).find((t) => COUNTRY_TOKEN_LABELS[t] === countryName);
  const iso = token ? COUNTRY_TOKEN_ISO[token] : null;
  return iso ? isoToFlagEmoji(iso) : '🏳️';
};
