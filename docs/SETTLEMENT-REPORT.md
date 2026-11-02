# Raporti i shlyerjes së tregjeve

Gjendja e secilit treg nga raporti i adminit ("Tregjet"). Katër nivele, sipas kërkesës:

1. **Implementuar** — ka rregull shlyerjeje në kod.
2. **Testuar** — ka teste njësie (dhe, ku shënohet, provë e plotë me Postgres të vërtetë: biletë → shlyerje → bilanc).
3. **Verifikuar me të dhëna reale** — formati i opsioneve është nga feed-i real (raporti i tregjeve ose bileta reale). Kuptimi i tregut mbetet interpretim derisa të konfirmohet nga ty.
4. **Në pritje** — nuk shlyhet vetë; arsyeja është shkruar.

Çdo rregull që nuk është i sigurt kthen "pezull" (nuk hamendëson). Bileta pezull NUK kthehet më automatikisht: mbetet e hapur derisa admini ose super admini ta mbyllë me dorë (Fituese / Humbëse).

## A. Implementuar + testuar (format real, kuptim i qartë)

| Tregu | Si vendoset |
|---|---|
| Rezultati i Saktë, Numri i Golave Udhëtuesi/Shtëpiaku, 45/90, Rezultat Final & Numri i Golave, 45/90 & Numri i Golave, Në cilën pjesë më shumë korne | nga bileta reale (foto); prova e plotë me Postgres |
| Sa gola shënohen / sa gola shënon ekipi në pjesën 1 ose 2 | gola të pjesës = pushimi / final minus pushimi |
| Sasia e golave (pjesë dhe përfundimtare), Shuma e saktë e golave, Home/Away multigoals | intervali "0", "1-2", "3+" kundrejt golave |
| Gol-JoGol në pjesën 1 / 2, ekipi shënon në të dy pjesët, Pjesa me më shumë gola, Home/Away highest scoring half | sipas golave për pjesë |
| Clean sheet (ndeshje, pjesa 1, pjesa 2) | gola të pësuar = 0 |
| Fiton me zero, fiton një pjesë, fiton të dy pjesët | sipas golave për pjesë |
| Any team / Home / Away to win, Dopio Shans pjesa 1 / 2, DopioShans Live, Rezultati i pjesës së dytë | rezultati i seleksionuar kundrejt rezultatit |
| Barazim / Fiton Pritesi / Fiton Udhëtuesi ose 0-2 gola, ose 3+, ose Gol/JoGol | OR midis rezultatit dhe kushtit të golave |
| Dopio Shans me Kombinime ("1X_0-1"), Rezultat Final/Gol-JoGol, Lart-Poshtë/Gol-JoGol | të dyja pjesët duhet të plotësohen |
| Tek/Çift pjesa 1 / 2 | golat e pjesës tek ose çift |
| Rezultat i saktë pjesa 1, pjesa 2, Pjesa 1/Final, Rezultati Saktë Live | rezultati i saktë; "Të Tjera" mbetet pezull (kërkon listën e opsioneve) |
| Handikap Europian (ndeshje, pjesa 1, pjesa 2) | "1 0:1" = shtëpiaku fillon me 0 gola, mysafiri me 1; rezultati i modifikuar vendos 1/X/2 (konfirmuar me shembullin tënd: 2-0 me 0:1 bëhet 2-1) |
| Corner 1x2 dhe 1st half corner 1x2 | ekipi me më shumë korne (pjesa 1 nga numëruesit e pushimit) |
| Sending off (ndeshje, Home, Away) | numëruesi i kartonave të kuq |
| 1st half sending off (+ Home/Away) | numëruesi i kuq në pushim (ruhet nga migrimi 0005; vetëm ndeshje pas deploy-t) |
| Rezultati Final Gola 3+ / 4+ (opsionet 1/X/2 ose Po/Jo) | **Supozim:** rezultati i zgjedhur dhe të paktën N gola totale (Po/Jo: vetëm kushti i golave). Pa verifikuar me feed. |
| Cila skuadër shënon golin e parë / të fundit | renditja e golave nga ngjarjet, vetëm kur është e besueshme |
| Shënon golin e dytë (skuadra); Goli i parë në pjesën e parë ("None 1","1 1","2 1") | renditja e golave nga ngjarjet; "1" e fundit supozohet periudha 1 (**pa verifikuar**); X në golin e dytë nuk shlyhet |
| Godet kornen e parë / të fundit; Merr kartonin e parë; Gara e Korneve | renditja e ngjarjeve. Çdo ngjarje mban numrin rrjedhës të ekipit ("korneri i 5-të i shtëpiakut"), prandaj një boshllëk në log (ngjarje e humbur kur serveri ishte i fikur) nuk e pengon më: i fundit = më i vonshmi i ngjarjeve me numrin e fundit të secilit ekip, i pari = më i hershmi i atyre me numër 1, Gara në N = ngjarjet me numër N. Mbetet pezull vetëm kur ngjarja vendimtare vetë mungon ose dy ekipet kanë të njëjtën kohë |
| To qualify (1 / 2) | shuma e golave të dy ndeshjeve pas kohës rregulluese: ndeshja tjetër (të njëjtat ekipe, anët e ndërruara, të njëjtën garë, brenda 75 ditëve) merret nga matches_cache ose nga arkivi `match_results` (migrimi 0019, 90 ditë), sepse ndeshja e parë del nga cache pas rreth një jave. Shuma e pabarabartë vendos; shuma e barabartë (kohë shtesë / penalti, që feed-i nuk i jep) dhe ndeshja tjetër që mungon ose s'ka mbaruar mbeten pezull për mbyllje me dorë |
| Home/Away/Draw or any clean sheet | **Yes = rezultati OR ndonjëra skuadër pa pësuar gol; No = e kundërta** (sipas specifikimit; i pa verifikuar me feed) |

## B. Vijat aziatike (pagesa e plotë) — implementuar + testuar + prova me Postgres

Handikap Aziatik (ndeshje, pjesa 1, pjesa 2), Handikap - Pjesa 1, Lart/Poshtë Gola Aziatikë (ndeshje, pjesa 1, pjesa 2), si dhe tregu i zakonshëm Handikap.

- Vijë e plotë: fitore, VOID kur barazon, humbje.
- Vijë gjysmë: fitore ose humbje.
- Vijë çereku (0.25, 0.75, ...): stake ndahet në dy pjesë në vijat fqinje. Rezultatet: fitore e plotë, gjysmë fitore, VOID, gjysmë humbje, humbje e plotë.
- Pagesa për një shënjestër (leg): fitore = koeficient; gjysmë fitore = 1 + (koef. − 1)/2; VOID = 1; gjysmë humbje = 0.5; humbje = 0. Në bileta të shumëfishta shumëzohen faktorët.
- Prova me Postgres: bilanci 770 saktësisht; shlyerja e përsëritur (3 kalime) nuk paguan dy herë.
- Bileta me gjysmë humbje ruhet si "WON" me pagesë më të vogël se stake që raportet e adminit të dalin saktë, dhe te UI shfaqet "Humbje e pjesshme".
- Në këto tregje opsionet që vijnë pa numër ("Lart", "Poshte") nuk shlyhen (nuk dihet vija).

## C. Tregjet me kuptim të pakonfirmuar: lexim i vetëm i zgjedhur (shlyhen gjithmonë)

Për këto nuk kemi shpjegim nga londonpro365, ndaj është zgjedhur leximi më i mundshëm. Nëse një lexim del i gabuar, ndryshohet vetëm ai rregull.

| Tregu | Leximi i përdorur |
|---|---|
| Fitore/Fitore (1, 2) dhe variantet pjesa 1 / pjesa 2 | Draw No Bet: ekipi fiton, humbet, ose barazimi rimbursohet |
| Total bookings (+ pjesa 1), Home/Away exact bookings | **Konfirmuar nga pronari:** vetëm kartona realë (verdhë 1, kuq 1), kurrë pikë, pavarësisht vijës |
| Booking 1x2 (+ pjesa 1) | **Konfirmuar:** krahasohen kartonët realë (verdhë 1, kuq 1); i barabartë = X; P1 = vetëm kartonët e pjesës 1 |
| Rezultat Final me Kartona, Rezultat i P1 me kartona, Rezultat i P2 me kartona | 1 / X / 2 + vija e kartonave në një opsion ("1 & Lart 3.5", "1 / 3.5 Lart", "X Nen 4.5": çdo renditje dhe ndarës). "3.5 Lart" = 4 kartona ose më shumë, "3.5 Nen" = 3 ose më pak. Final = rezultati dhe kartonat e gjithë ndeshjes; P1 / P2 = rezultati dhe kartonat vetëm të asaj pjese (P2 = fundi minus pushimi). Vija mund të jetë edhe në fund të emrit të tregut |
| Halftime/fulltime & exact goals | Opsioni "pushim/fund & gola" ("2/2 & 3", "2-X/0-1") ose "3 Home/Home": të tria duhet të jenë të sakta |
| RP1/RP2 & Gol/JoGol | Opsioni "GG / JG" = Gol/JoGol i pjesës 1, pastaj i pjesës 2 (GG = të dyja ekipet shënojnë në atë pjesë, JG = jo). Leximi i vjetër "2/X & Gol" (rezultati i pjesëve + të dyja shënojnë) mbetet për atë formë opsioni |
| Rezultati i saktë i pjesës 1, "Të Tjera" | Çdo rezultat me 3+ gola të një ekipi në pjesë |
| Sending off pjesa 2 | Të kuqtë në fund minus të kuqtë në pushim |
| Goli i parë në pjesën e parë, "or any clean sheet", Rezultati Final Gola N+, handikapi aziatik | Siç thuhet te seksioni A |

Nëse formati i opsionit nuk përputhet me atë që pritet (p.sh. "Rezultat Final me Kartona"), bileta mbetet pezull deri në mbylljen automatike më poshtë.

## D. Pa rregull dhe mbyllja automatike

Tregjet e fshehura (nuk dalin në tabelë, nuk pranojnë baste, nuk hyjnë në raportin e mbulimit): "A do të ketë kohë shtesë?", "Overtime & goal", "Winning method", "Will there be a penalty shootout", "A do te kete penallti gjate ndeshjes?". "Home no bet" (vetëm opsioni 1) dhe "Away no bet" (vetëm opsioni 2) ofrohen: fiton ekipi, barazimi kthen shumën, humbet tjetri; opsionet e tjera të tyre (X) nuk ofrohen. Biletat që ishin vënë para fshehjes mbeten për mbyllje me dorë.

| Tregu | Çfarë ndodh |
|---|---|
| Penallti gjatë ndeshjes | Feed-i nuk jep ngjarje penalltie. Shlyhet me dorë nga admini (skeda **Pezull**), përndryshe mbetet e hapur derisa admini ta mbyllë me dorë (Fituese / Humbëse); rimbursimi automatik është fikur (`UNSETTLED_BET_VOID_AFTER_HOURS=0`). |
| Çdo bilet që nuk shlyhet për arsye të tjera (të dhëna që mungojnë, format i panjohur, ngjarje pa renditje) | Mbetet e hapur për t'u mbyllur me dorë nga admini (rimbursimi automatik është fikur; mund të ndizet me `UNSETTLED_BET_VOID_AFTER_HOURS` > 0). Askush nuk humbet para, dhe asnjë bilet nuk mbetet i hapur. |

**Shlyerja me dorë (skeda "Pezull" te admini).** Liston, për ndeshjet e mbaruara, çdo treg dhe selektim që ende ka bileta pezull. Me butonat Fitues / Humbës / Rimburso vendos të gjitha biletat e atij rreshti njëherësh. Thirrja e dytë nuk paguan përsëri.


**Rregulli 7 (konfirmuar):** "Halftime/Fulltime" (HT/FT) = rezultati i pjesës 1 + rezultati FINAL i ndeshjes. "Pushim/Fund" (45/90) mbetet sipas gjysmave (pjesa 1, pastaj pjesa 2 më vete). Janë dy tregje të ndryshme.
