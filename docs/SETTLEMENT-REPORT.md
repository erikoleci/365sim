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

## B. Vijat aziatike (pagesa e plotë) — implementuar + testuar + prova me Postgres

Handikap Aziatik (ndeshje, pjesa 1, pjesa 2), Handikap - Pjesa 1, Lart/Poshtë Gola Aziatikë (ndeshje, pjesa 1, pjesa 2), si dhe tregu i zakonshëm Handikap.

- Vijë e plotë: fitore, VOID kur barazon, humbje.
- Vijë gjysmë: fitore ose humbje.
- Vijë çereku (0.25, 0.75, ...): stake ndahet në dy pjesë në vijat fqinje. Rezultatet: fitore e plotë, gjysmë fitore, VOID, gjysmë humbje, humbje e plotë.
- Pagesa për një shënjestër (leg): fitore = koeficient; gjysmë fitore = 1 + (koef. − 1)/2; VOID = 1; gjysmë humbje = 0.5; humbje = 0. Në bileta të shumëfishta shumëzohen faktorët.
- Prova me Postgres: bilanci 770 saktësisht; shlyerja e përsëritur (3 kalime) nuk paguan dy herë.
- Bileta me gjysmë humbje ruhet si "WON" me pagesë më të vogël se stake që raportet e adminit të dalin saktë, dhe te UI shfaqet "Humbje e pjesshme".
- Në këto tregje opsionet që vijnë pa numër ("Lart", "Poshte") nuk shlyhen (nuk dihet vija).

## C. Kuptim i pakonfirmuar: shlyhen vetëm kur të gjitha leximet e mundshme përputhen

| Tregu | Si vendoset |
|---|---|
| Fitore/Fitore (1, 2) | Tre lexime: pa-barazim (Draw No Bet), fiton të dy pjesët, fiton në pushim dhe në fund. Shlyhet vetëm kur të tria japin të njëjtin rezultat (p.sh. ekipi fiton të dy pjesët). Barazimi ose fitorja pa fituar të dyja pjesët mbetet pezull. |
| Fitore/Fitore pjesa 1, Fitore - Fitore pjesa 2 | Dy lexime: pa-barazim i pjesës ose "fiton pjesën". Shlyhet kur ekipi fiton ose humbet pjesën; barazimi i pjesës mbetet pezull. |
| Total bookings (+ pjesa 1), Home/Away exact bookings | Njësia nxirret nga vija (nën 10 = kartona, 10+ = pikë). Kartona: kuq = 1 ose 2; pikë: kuq = 25, 20 ose 40. Shlyhet vetëm kur të gjitha skemat japin të njëjtën anë; pa karton të kuq ato përputhen gjithmonë. |
| Rezultat Final me Kartona, Rezultat i P1 me kartona | Opsioni pritet si "1 & Lart 3.5" (ndarës &, /, - ose hapësirë); nëse formati është tjetër mbetet pezull. Kartonat me të njëjtën rregull si më sipër. |

## D. Në pritje dhe shlyerja me dorë

| Tregu | Arsyeja |
|---|---|
| Penallti gjatë ndeshjes | Feed-i nuk jep ngjarje penalltie. Shlyhet me dorë nga admini → skeda **Pezull**. |
| Halftime/fulltime & exact goals, RP1/RP2 & Gol/JoGol | Formati i opsioneve nuk dihet. |
| Booking 1x2 pjesa 1 | Nuk ka rregull. |
| Sending off pjesa 2 | Nuk ruhet. |
| Rezultati i saktë i pjesës 1, opsioni "Të Tjera" | Duhet lista e plotë e opsioneve të tregut. |
| Booking 1x2 me karton të kuq | Bëhet vetëm kur asnjë ekip nuk ka karton të kuq; me të kuq mbetet pezull. |
| Tregjet e ngjarjeve me ngjarje të munguara ose me barazim kohe | Renditja nuk shpiket. |

**Shlyerja me dorë (skeda "Pezull" te admini).** Liston, për ndeshjet e mbaruara, çdo treg dhe selektim që ende ka bileta pezull. Me butonat Fitues / Humbës / Rimburso vendos të gjitha biletat e atij rreshti njëherësh. Bileta paguhet ose mbyllet me të njëjtën rrugë si shlyerja automatike; thirrja e dytë nuk paguan përsëri.

## E. Si lexohet raporti i tregjeve te admini

"Tregjet" → "PA RREGULL" duhet të mbetet vetëm me tregjet e seksionit C. Çdo emër tjetër që del aty është një emër që nuk e kemi parë ende: dërgoje me opsionet e tij dhe shtohet rregulli.
