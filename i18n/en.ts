// English translations, keyed by the exact Albanian source text used in the code.
// Add new entries here whenever a new t('...') string is introduced.
// Placeholders such as {n} must be kept identical in both languages.
//
// Core/shared strings live here; each area has its own file under ./en/ and
// they are merged at the bottom. Duplicate keys across files are harmless
// (the later spread wins), but keep the translation consistent.
import { enAdmin } from './en/admin';
import { enCasino } from './en/casino';
import { enApp } from './en/app';
import { enUtils } from './en/utils';

export const enCore: Record<string, string> = {
  // --- Navbar ---
  'Userat e Mi': 'My Users',
  'Rezultate': 'Results',
  'Gjuha': 'Language',

  // --- Login ---
  'Diçka shkoi keq. Provo përsëri.': 'Something went wrong. Please try again.',
  'Hyr në llogarinë tënde': 'Sign in to your account',
  'Përdoruesi': 'Username',
  'Shkruaj përdoruesin': 'Enter your username',
  'Fjalëkalimi': 'Password',
  'Shkruaj fjalëkalimin': 'Enter your password',
  'Fshih fjalëkalimin': 'Hide password',
  'Shfaq fjalëkalimin': 'Show password',
  'Duke u lidhur me serverin…': 'Connecting to the server…',
  'Një moment…': 'One moment…',
  'Hyr': 'Sign in',
  "S'ke llogari? Kontakto administratorin ose agjentin tënd për ta hapur.": "Don't have an account? Contact your administrator or agent to open one.",

  // --- Live status (utils/liveStatus.ts) ---
  'Pushim (Pjesa e Parë ka Mbaruar)': 'Half-time (first half over)',
  'Ka Mbaruar': 'Full time',
  'Vazhdime': 'Extra time',
  'Penallti': 'Penalties',
  'Pjesa 1': '1st half',
  'Pjesa 2': '2nd half',
  'Pjesa e Parë': 'First half',
  'Pjesa e Dytë': 'Second half',

  // --- Match clock halves (MatchCard / LivePitch) ---
  'Pjesa I': '1st half',
  'Pjesa II': '2nd half',
  'Pushim': 'Half-time',
  'Shtesë': 'Extra time',

  // --- BetSlip ---
  'Konfirmo Biletën': 'Confirm Your Bet',
  'Kuota Totale': 'Total Odds',
  'Fitimi i Mundshëm': 'Potential Return',
  'Anulo': 'Cancel',
  'Vendos Biletën': 'Place Bet',
  'Bileta': 'Bet Slip',
  'Biletat e Mia': 'My Bets',
  'Bileta jote është bosh': 'Your bet slip is empty',
  'Zgjidh një kuotë nga tabela e ndeshjeve për ta shtuar këtu.': 'Pick odds from the match list to add them here.',
  'Hiq të Gjitha': 'Remove All',
  'Kuota ndryshoi': 'Odds changed',
  'Zgjedhjet nuk mund të kombinohen': "These selections can't be combined",
  'Disa zgjedhje të së njëjtës ndeshje janë të lidhura logjikisht me njëra-tjetrën (njëra vendos ose mbulon tjetrën), ndaj kuota totale do të ishte e gabuar. Hiq njërën nga zgjedhjet e shënuara me të kuqe për të vendosur biletën.': "Some selections from the same match are logically linked (one decides or covers the other), so the combined odds would be wrong. Remove one of the selections marked in red to place the bet.",
  'Lidhet me: {list}': 'Linked to: {list}',
  'Nuk shtohet: ka të njëjtën logjikë me {list}': 'Not added: it follows the same logic as {list}',
  'Hiq zgjedhjet e lidhura për të vendosur biletën': 'Remove the linked selections to place the bet',
  'Kuotat ndryshuan ({n})': 'Odds changed ({n})',
  "Çmimi u përditësua më poshtë. Prano ndryshimet dhe vendos biletën sërish, ose hiqe zgjedhjen nëse s'e pranon.": "The price was updated below. Accept the changes and place your bet again, or remove the selection if you don't accept it.",
  'Hiq nga bileta': 'Remove from bet slip',
  '{n}-Fish': '{n}-Fold',
  'Bast i Thjeshtë': 'Single Bet',
  "Kuotë e vlerësuar (shumëzim i kuotave individuale) — asnjë provider nuk jep çmim të dedikuar SGM, kështu që ky kombinim s'e llogarit varësinë mes rezultateve në të njëjtën ndeshje.": "Estimated odds (the individual odds multiplied together) — no provider offers a dedicated SGM price, so this combination does not account for how outcomes in the same match depend on each other.",
  'Prano Ndryshimet & Vendos': 'Accept Changes & Place Bet',
  'Fonde të pamjaftueshme': 'Insufficient funds',
  "Ende s'ke bileta": "You have no bets yet",
  'Biletat e vendosura shfaqen këtu, me statusin e tyre në kohë reale.': 'Placed bets appear here, with their status in real time.',
  'Hapur': 'Open',
  'Fituar': 'Won',
  'Rimbursuar': 'Refunded',
  'Humbur': 'Lost',
  'Anulo Biletën': 'Cancel Bet',

  // --- MatchCard ---
  'Hiq nga të preferuarat': 'Remove from favourites',
  'Shto te të preferuarat': 'Add to favourites',
  'Pa përditësim nga provider-i': 'No update from the provider',
  'Gola {team} (shtëpi):': 'Goals {team} (home):',
  'Gola {team} (mysafir):': 'Goals {team} (away):',
  'Rezultat i pavlefshëm.': 'Invalid score.',
  'Tregu është pezulluar përkohësisht': 'This market is temporarily suspended',

  // --- Shared / list helpers ---
  'Shfaq më shumë': 'Show more',

  // --- MatchDetail ---
  'Të Gjitha': 'All',
  'Kryesore': 'Main',
  'Golat': 'Goals',
  'Gol/JoGol': 'Both Teams to Score',
  'Hendikep': 'Handicap',
  'Lart': 'Over',
  'Poshtë': 'Under',
  'Poshte': 'Under',
  'Mbi': 'Over',
  'Nën': 'Under',
  'Nen': 'Under',
  'Kartona': 'Cards',
  'Korne': 'Corners',
  'Golashenues': 'Goalscorers',
  'Speciale': 'Specials',
  'Kthehu': 'Back',
  'Statistika': 'Statistics',
  'Ngjarjet': 'Events',
  'Duke ngarkuar statistikat...': 'Loading statistics...',
  "Statistika live s'janë të disponueshme për këtë ndeshje.": 'Live statistics are not available for this match.',
  'Statistika nga burimi i të dhënave — jo verifikim zyrtar': 'Statistics from the data source — not an official verification',
  'Zoterim topi': 'Possession',
  'Goditje ne porte': 'Shots on target',
  'Goditje jashte porte': 'Shots off target',
  'Kartonë': 'Cards',
  'Duke ngarkuar ngjarjet...': 'Loading events...',
  'Rezultati është {score}. Provider-i jep vetëm rezultatin: golashënuesit dhe minutat e golave nuk janë të disponueshme.': 'The score is {score}. The provider only supplies the score: goalscorers and goal minutes are not available.',
  "Ende s'ka ngjarje të regjistruara.": 'No events recorded yet.',
  'Fundi i pjesës së parë': 'End of first half',
  'Fundi i kohës rregullt': 'End of regular time',
  'Kredit vetëm nga super admini': 'Credit only from the super admin',
  '⚽ Gol': '⚽ Goal',
  '🟨 Kartion i verdh': '🟨 Yellow card',
  '🟥 Karton i kuq': '🟥 Red card',
  '🔄 Nderrim': '🔄 Substitution',
  '🚩 Korne': '🚩 Corner',
  '📺 Arbitri shikon VAR': '📺 VAR check',

  // --- Server-supplied market names (best effort; unknown names stay as supplied) ---
  '1X2 - Fituesi': '1X2 - Match Winner',
  'Totali i Golave': 'Total Goals',
  'Të dy Skuadrat Shënojnë': 'Both Teams to Score',
  'Shans i Dyfishtë': 'Double Chance',
  'Barazimi = Rimbursim': 'Draw No Bet',
  'Hendikep Asian': 'Asian Handicap',
  'Barazim': 'Draw',
  'Po': 'Yes',
  'Jo': 'No',

  // --- LivePitch (action labels come from server/liveAction.js) ---
  'Ndeshja live': 'Live match',
  'Karton i kuq': 'Red card',
  'Karton i verdhë': 'Yellow card',
  'Sulm i rrezikshëm': 'Dangerous attack',
  'Sulm': 'Attack',
  'Zotëron topin': 'In possession',
  'Rivënie fundore': 'Goal kick',
  'Goditje në portë': 'Shot on target',
  'Ndërrim': 'Substitution',
  'Rivënie anësore': 'Throw-in',
  'Pozicion jashtë loje': 'Offside',
};

export const en: Record<string, string> = { ...enCore, ...enUtils, ...enApp, ...enAdmin, ...enCasino };
