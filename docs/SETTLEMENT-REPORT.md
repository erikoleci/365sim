# Raporti i shlyerjes së tregjeve

Gjendja e secilit treg nga raporti i adminit ("Tregjet"). Katër nivele, sipas kërkesës:

1. **Implementuar** — ka rregull shlyerjeje në kod.
2. **Testuar** — ka teste njësie (dhe, ku shënohet, provë e plotë me Postgres të vërtetë: biletë → shlyerje → bilanc).
3. **Verifikuar me të dhëna reale** — formati i opsioneve është nga feed-i real (raporti i tregjeve ose bileta reale). Kuptimi i tregut mbetet interpretim derisa të konfirmohet nga ty.
4. **Në pritje** — nuk shlyhet vetë; arsyeja është shkruar.

Çdo rregull që nuk është i sigurt kthen "pezull" (nuk hamendëson). Bileta pezull kthehet automatikisht pas 24 orësh.

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
| Godet kornen e parë / të fundit; Merr kartonin e parë | renditja e ngjarjeve, vetëm kur numri i ngjarjeve përputhet me numëruesin dhe nuk ka barazim kohe |
| Home/Away/Draw or any clean sheet | **Yes = rezultati OR ndonjëra skuadër pa pësuar gol; No = e kundërta** (sipas specifikimit; i pa verifikuar me feed) |

## A2. Formatet e opsioneve që lexohen (një parser i përbashkët: `server/selectionParse.js`)

Një opsion nuk mbetet më pezull vetëm sepse është shkruar ndryshe. Çdo format më poshtë jep gjithmonë fitore ose humbje (testet në `tests/selectionFormats.test.js` kalojnë mbi 10 000 kombinime):

| Familja | Formatet e pranuara | Kuptimi |
|---|---|---|
| Numër (gola, korne, karton) | `10+`, `+10`, `10 +`, `>=10`, `10 e më shumë`, `10 or more`, `3+ gola` | të paktën 10 |
| | `9` (te tregjet "Shuma / Totali / Numri") | saktësisht 9 |
| | `0-8`, `2 – 3`, `2 deri 3` | nga-deri (përfshirë skajet) |
| | `-8`, `8-`, `<=8`, `8 e më pak`, `max 8` | më së shumti 8 |
| Dopio Shans | `X2`, `x2`, `2X`, `x-2`, `x/2`, `Barazim ose 2`, `Fiton Udhëtuesi ose Barazim`, `Beta ose Barazim`, `Alpha_or_Draw` | barazim ose fiton ekipi i dytë (analoge për `1X` dhe `12`) |
| 45/90 (pushim/fund) | `x-2`, `X/2`, `x 2`, `x\|2`, `Barazim/2` | rezultati në minutën 45 dhe rezultati në minutën 90 |
| 45/90 + gola | `x-2/+3`, `x-2/3+`, `x/2/+3`, `x-2 & 3 e më shumë` në tregjet `45/90 & Numri i Golave`, `& Gola`, `& Totali`, `dhe Numri i Golave`, `45/90 Pjesë Gola` | `x` në pushim, `2` në fund dhe 3 ose më shumë gola gjithsej |
| Dopio Shans + gola | `x2_3+`, `x2_+3`, `X2 & 3+`, `1x/2-3` | të dyja kushtet duhet të plotësohen |

Rregulla të sigurisë: një numër i vetëm (`1`, `2`) te një treg anësor (p.sh. "cila skuadër ka më shumë korne") nuk lexohet kurrë si numër; `Mbi 9` mbetet vijë Lart/Poshtë, jo numër. Ç'nuk njihet kthehet pezull si më parë.

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
| Total bookings (+ pjesa 1), Home/Away exact bookings | Njësia nga vija: nën 10 = kartona (verdhë 1, kuq 1); 10 e lart = pikë (verdhë 10, kuq 25) |
| Booking 1x2 (+ pjesa 1) | Pikët e kartonave (verdhë 10, kuq 25) |
| Rezultat Final me Kartona, Rezultat i P1 me kartona | Opsioni "1 & Lart 3.5" (ndarës &, /, - ose hapësirë); kartonat si më sipër |
| Halftime/fulltime & exact goals | Opsioni "pushim/fund & gola" ("2/2 & 3", "2-X/0-1"): të tria duhet të jenë të sakta |
| RP1/RP2 & Gol/JoGol | Rezultati i pjesës 1, rezultati i pjesës 2 dhe të dyja shënojnë ("2/X & Gol") |
| Rezultati i saktë i pjesës 1, "Të Tjera" | Çdo rezultat me 3+ gola të një ekipi në pjesë |
| Sending off pjesa 2 | Të kuqtë në fund minus të kuqtë në pushim |
| Goli i parë në pjesën e parë, "or any clean sheet", Rezultati Final Gola N+, handikapi aziatik | Siç thuhet te seksioni A |

Nëse formati i opsionit nuk përputhet me atë që pritet (p.sh. "Rezultat Final me Kartona"), bileta mbetet pezull deri në mbylljen automatike më poshtë.

## D. Pa rregull dhe mbyllja automatike

| Tregu | Çfarë ndodh |
|---|---|
| Penallti gjatë ndeshjes | Feed-i nuk jep ngjarje penalltie. Shlyhet me dorë nga admini (skeda **Pezull**), përndryshe rimbursohet automatikisht 4 orë pas fillimit të ndeshjes. |
| Çdo bilet që nuk shlyhet për arsye të tjera (të dhëna që mungojnë, format i panjohur, ngjarje pa renditje) | Rimbursohet automatikisht 4 orë pas fillimit të ndeshjes (`UNSETTLED_BET_VOID_AFTER_HOURS`, më parë 24 orë). Askush nuk humbet para, dhe asnjë bilet nuk mbetet i hapur. |

**Shlyerja me dorë (skeda "Pezull" te admini).** Liston, për ndeshjet e mbaruara, çdo treg dhe selektim që ende ka bileta pezull. Me butonat Fitues / Humbës / Rimburso vendos të gjitha biletat e atij rreshti njëherësh. Thirrja e dytë nuk paguan përsëri.

