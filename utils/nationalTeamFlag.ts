// National teams (Nations League, qualifiers, friendlies) have no club crest: Flashscore gives them a flag token, not a picture.
// Their team NAME is the country name, so the crest is the country's flag emoji. Exact names only (no fuzzy matching): a wrong flag
// is worse than the neutral initials tile. Youth / women suffixes ("Spain U21", "England W") keep the country's flag.
import { teamKey } from './teamLogoKey.js';

const ISO: Record<string, string> = {};
// "ISO:Name|Alias|Alias" lines; names are in English, lower-cased through teamKey() when matched.
const RAW = `AF:Afghanistan AL:Albania DZ:Algeria AD:Andorra AO:Angola AG:Antigua and Barbuda AR:Argentina AM:Armenia AU:Australia AT:Austria AZ:Azerbaijan
BS:Bahamas BH:Bahrain BD:Bangladesh BB:Barbados BY:Belarus BE:Belgium BZ:Belize BJ:Benin BM:Bermuda BT:Bhutan BO:Bolivia BA:Bosnia and Herzegovina|Bosnia-Herzegovina|Bosnia
BW:Botswana BR:Brazil BN:Brunei BG:Bulgaria BF:Burkina Faso BI:Burundi KH:Cambodia CM:Cameroon CA:Canada CV:Cape Verde|Cabo Verde CF:Central African Republic
TD:Chad CL:Chile CN:China|China PR CO:Colombia KM:Comoros CG:Congo CD:DR Congo|Congo DR|Democratic Republic of the Congo CR:Costa Rica CI:Ivory Coast|Cote d'Ivoire|Cote dIvoire
HR:Croatia CU:Cuba CW:Curacao CY:Cyprus CZ:Czechia|Czech Republic DK:Denmark DJ:Djibouti DM:Dominica DO:Dominican Republic EC:Ecuador EG:Egypt SV:El Salvador
GQ:Equatorial Guinea ER:Eritrea EE:Estonia SZ:Eswatini|Swaziland ET:Ethiopia FO:Faroe Islands FJ:Fiji FI:Finland FR:France GA:Gabon GM:Gambia GE:Georgia DE:Germany
GH:Ghana GI:Gibraltar GR:Greece GD:Grenada GT:Guatemala GN:Guinea GW:Guinea-Bissau GY:Guyana HT:Haiti HN:Honduras HK:Hong Kong HU:Hungary IS:Iceland IN:India
ID:Indonesia IR:Iran IQ:Iraq IE:Ireland|Republic of Ireland IL:Israel IT:Italy JM:Jamaica JP:Japan JO:Jordan KZ:Kazakhstan KE:Kenya KI:Kiribati XK:Kosovo KW:Kuwait
KG:Kyrgyzstan LA:Laos LV:Latvia LB:Lebanon LS:Lesotho LR:Liberia LY:Libya LI:Liechtenstein LT:Lithuania LU:Luxembourg MO:Macau MG:Madagascar MW:Malawi MY:Malaysia
MV:Maldives ML:Mali MT:Malta MR:Mauritania MU:Mauritius MX:Mexico MD:Moldova MN:Mongolia ME:Montenegro MA:Morocco MZ:Mozambique MM:Myanmar NA:Namibia NP:Nepal
NL:Netherlands|Holland NZ:New Zealand NI:Nicaragua NE:Niger NG:Nigeria KP:North Korea|Korea DPR MK:North Macedonia|Macedonia NO:Norway OM:Oman PK:Pakistan PS:Palestine
PA:Panama PG:Papua New Guinea PY:Paraguay PE:Peru PH:Philippines PL:Poland PT:Portugal PR:Puerto Rico QA:Qatar RO:Romania RU:Russia RW:Rwanda KN:Saint Kitts and Nevis
LC:Saint Lucia VC:Saint Vincent and the Grenadines WS:Samoa SM:San Marino ST:Sao Tome and Principe SA:Saudi Arabia SN:Senegal RS:Serbia SC:Seychelles SL:Sierra Leone
SG:Singapore SK:Slovakia SI:Slovenia SB:Solomon Islands SO:Somalia ZA:South Africa KR:South Korea|Korea Republic|Korea SS:South Sudan ES:Spain LK:Sri Lanka SD:Sudan
SR:Suriname SE:Sweden CH:Switzerland SY:Syria TW:Taiwan|Chinese Taipei TJ:Tajikistan TZ:Tanzania TH:Thailand TL:Timor-Leste TG:Togo TO:Tonga TT:Trinidad and Tobago
TN:Tunisia TR:Turkey|Turkiye TM:Turkmenistan UG:Uganda UA:Ukraine AE:United Arab Emirates|UAE US:United States|USA|United States of America UY:Uruguay UZ:Uzbekistan
VU:Vanuatu VE:Venezuela VN:Vietnam YE:Yemen ZM:Zambia ZW:Zimbabwe`;

// The entries are separated by single spaces, but names contain spaces too: split at every "XX:" marker instead.
for (const m of RAW.replace(/\n/g, ' ').matchAll(/([A-Z]{2}):(.*?)(?=\s[A-Z]{2}:|$)/g)) {
  for (const name of m[2].trim().split('|')) ISO[teamKey(name)] = m[1];
}

const tagFlag = (tags: string) => String.fromCodePoint(0x1f3f4, ...[...tags].map((c) => 0xe0000 + c.charCodeAt(0)), 0xe007f);
const SUBDIVISION: Record<string, string> = {
  england: tagFlag('gbeng'), scotland: tagFlag('gbsct'), wales: tagFlag('gbwls'), 'northern ireland': '🇬🇧',
};

const isoFlag = (iso: string) => String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
// "Spain U21" / "England W" / "Italy Women" -> the country part
const SUFFIX = /\s+(u\s?\d{2}|w|women|womens|ladies|olympic|b)$/i;

/** The flag emoji for a national team name ("Armenia", "Turkiye", "Spain U21"), or null when the name is not a country. */
export function nationalTeamFlag(name: string | null | undefined): string | null {
  if (!name) return null;
  const base = String(name).replace(SUFFIX, '');
  const key = teamKey(base);
  if (SUBDIVISION[key]) return SUBDIVISION[key];
  const iso = ISO[key];
  return iso ? isoFlag(iso) : null;
}
