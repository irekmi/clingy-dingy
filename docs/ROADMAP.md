# Roadmapa

## Etap 1: grywalny pojedynek (obecny)
- [x] Podzielony ekran: Ty po lewej, przeciwnik po prawej
- [x] Sterowanie rytmiczne, prosta grafika patyczaka
- [x] Pokój z linkiem, gotowość, odliczanie, rewanż, bilans
- [x] Realtime przez Supabase (Presence + Broadcast) i tryb lokalny do testów
- [x] Lokalny timer jako wyznacznik wyniku oraz deterministyczny replay (weryfikacja przez przeciwnika i serwer)
- [x] Tabela `race_results` i widok `leaderboard`
- [ ] Testy z prawdziwymi graczami, dostrojenie trudności (`CFG` w `sim.ts`)
- [ ] Dźwięki: klik przy chwycie, metronom

## Wygląd (w trakcie projektowania)
Styl: płaska ilustracja wektorowa hali wspinaczkowej. Gra nazywa się **Clingy Dingy** (wcześniej robocza nazwa „Patyczaki”). Projekt jest na kanwie Design „Clingy Dingy – wygląd gry”.
- [x] Scena: hala o zachodzie słońca (okna z górami, ciemna podłoga, materace)
- [x] Wspinacz 2C „z detalami”: widok od tyłu, koszulka na ramiączkach, legginsy, buty wspinaczkowe, woreczek z magnezją. Dwie wersje kolorystyczne (Ty / przeciwnik), pozy: start, sięga, ześlizg, szczyt.
- [x] Ściana, chwyty i pierścień rytmu: wariant 3A. Twoja trasa to chwyty jednego koloru, inne kolory to ozdoba. Na następnym chwycie zaciska się pierścień (biały → żółty → zielony na celu), a stronę podpowiada strzałka w kółku.
- [x] HUD, timer i komunikaty: wariant 4B „pasek transmisji”. Jedna belka na środku u góry: gracze po bokach w swoich kolorach (imię, wysokość, combo), w środku Twój czas, pod spodem dwa paski wyścigu w górę. Komunikaty to duże komiksowe napisy z białym obrysem.
- [x] Menu, lobby i wyniki: styl 5C „studio transmisji”. Wąska belka CLINGY DINGY (TOR 1 / TOR 2) mieści się między ścianami, niżej karty graczy z VS i pasek akcji. Lobby i ekran wyników w tym samym układzie.
- [x] HUD 4B zwężony do szerokości przerwy między ścianami (~330 px), żeby nie zasłaniał torów.
- [x] Wdrożenie: `src/game/render.ts` (scena, chwyty, pierścień, wspinacz z pozami, komiksowe komunikaty), HUD i ekrany 5C w `src/main.ts` + `src/style.css`. Font Nunito jest hostowany lokalnie (@fontsource).
- [ ] Na wąskich ekranach (telefon) HUD przenosi się na dół – do przetestowania na prawdziwym telefonie
- [ ] **Konfigurator postaci** (później, np. razem z kontami): fryzura, kolor skóry, koszulka, spodnie, buty, opaska. Sylwetka 2C jako baza, wybór zapisany w profilu gracza i wysyłany przeciwnikowi w Presence.

## Etap 2: konta i uczciwość
- [ ] Supabase Auth (konto anonimowe → e-mail lub Google), stały nick, historia gier
- [ ] **Mecz tworzony na serwerze**: Edge Function `create-match` zwraca `matchId` i zapisuje go w tabeli `matches`. Wynik da się wtedy zgłosić tylko do meczu, który faktycznie się odbył, i tylko raz.
- [ ] **Strumieniowanie wciśnięć w trakcie biegu** (np. paczka co 0,5 s do serwera). Serwer porównuje swój zegar z deklarowanymi czasami, więc nie da się „wymyślić” idealnego logu po fakcie.
- [ ] Wykrywanie botów: statystyka trafień (np. 100% perfekt przy ±5 ms przez wiele gier), rozkład odchyleń, ręczna moderacja
- [ ] Ranking w grze (widok `leaderboard`)
- [ ] Rozstrzygnięcie zwycięzcy po stronie serwera (porównanie dwóch zweryfikowanych wyników)

## Etap 3: monetyzacja (dopiero po wyjaśnieniu kwestii prawnych)

Model docelowy: wpisowe np. 0,20 zł od gracza, zwycięzca dostaje 75% puli, 25% to prowizja.

### Najpierw prawo (to nie jest porada prawna)
- Ustawa o grach hazardowych obejmuje m.in. gry losowe i zakłady wzajemne, a hazard online w Polsce to w dużej mierze monopol państwa. Gra z wpisowym, wygraną pieniężną i prowizją operatora jest w szarej strefie, nawet jeśli decydują umiejętności.
- **Art. 2 ust. 6 ustawy:** Minister Finansów na wniosek rozstrzyga w drodze decyzji, czy dana gra jest grą hazardową. To najpewniejsza droga przed uruchomieniem płatności. Wniosek wymaga dokładnego opisu zasad gry, więc dobrze, że mechanika jest deterministyczna i opisana.
- Konsultacja z prawnikiem (prawo gier i usług płatniczych) oraz z księgowym (VAT od prowizji, rozliczenie wygranych, regulamin, RODO).
- Ograniczenie wieku 18+ i weryfikacja tożsamości przy wypłatach (KYC/AML).

### Ekonomia mikropłatności
- Opłata operatora za transakcję (procent plus stała kwota) jest większa niż 0,20 zł, więc **nie da się płacić za każdy mecz osobno**.
- Rozwiązanie: **portfel w grze**. Doładowanie np. od 10 zł (BLIK lub Przelewy24 przez Stripe), mecz pobiera wpisowe z salda, wypłata wygranych od np. 20 zł.
- Na koncie z 0,20 zł × 2 zostaje 0,10 zł prowizji za mecz. Przy 1000 meczów dziennie daje to ok. 100 zł dziennie przed kosztami i podatkami.
- Przechowywanie cudzych środków i wypłaty mogą wymagać licencji lub współpracy z instytucją płatniczą. To pytanie do prawnika i operatora płatności. Stripe wymaga uprzedniej zgody na „gry zręcznościowe z nagrodami pieniężnymi”.

### Techniczny szkic (gdy będzie zielone światło)
- Tabela `wallet_ledger` (tylko zapisy dopisywane, nigdy edytowane): wpłata, wpisowe, wygrana, prowizja, wypłata. Saldo liczone jako suma.
- Edge Function `stripe-webhook`: **webhook** od operatora płatności potwierdza wpłatę i dopisuje środki do portfela (podpis weryfikowany sekretem).
- Przy starcie meczu serwer blokuje wpisowe obu graczy. Po rozstrzygnięciu (Etap 2) serwer wypłaca 75% zwycięzcy, a 25% księguje jako prowizję. Przy remisie lub błędzie wpisowe wraca do graczy.

### Alternatywa o mniejszym ryzyku
- Płatne **żetony bez możliwości wypłaty** (zwycięzca dostaje żetony, nie pieniądze) albo reklamy i kosmetyczne skórki patyczaka. Taki model zwykle nie jest hazardem, ale też warto to potwierdzić.
