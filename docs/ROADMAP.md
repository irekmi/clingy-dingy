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
- [x] Konta: Supabase Auth (e-mail + hasło z potwierdzeniem), profil z unikalnym nickiem, gość może grać bez konta (bez rankingu)
- [x] Historia gier gracza (widok `my_results`), zmiana nicku i reset hasła w widoku „Moje konto”; logowanie i ranking na stałym pasku u góry menu
- [x] **Mecz tworzony na serwerze**: Edge Function `create-match` zapisuje mecz (tabela `matches`: pokój, uczestnicy, czas startu). Wynik da się zgłosić tylko do istniejącego meczu, tylko dla jego uczestników i tylko raz. Zgłoszenia ze starych klientów (bez meczu) są zapisywane z flagą `no_match` i nie liczą się do rankingu.
- [x] **Kontrola czasu ściennego** (zamiast strumieniowania wciśnięć): serwer zna start meczu, więc oznacza (flaga `too_fast`) bieg szybszy niż realnie upłynęło od startu + odliczania. Nie da się „wymyślić” idealnego logu po fakcie.
- [x] **Wykrywanie botów**: statystyka odchyłek trafień. Człowiek ma rozrzut ok. 15–30 ms, maszyna kilka ms. Flagi `robotic_precision` i `frame_perfect` oznaczają wynik jako podejrzany (zapisany do przeglądu, poza rankingiem). Ograniczenie: bot z dodanym losowym szumem może to ominąć, więc dojdzie ręczna moderacja.
- [x] Ranking ogólny (najlepszy czas każdego zalogowanego gracza, bez wyników podejrzanych) + ranking pokoju (najlepsze czasy i wygrane w serii rewanży)
- [x] Pokoje do 6 graczy: Twoja ściana po lewej, przeciwnicy w siatce, wyniki z miejscami
- [x] Zwycięzca rozstrzygany po stronie serwera: gdy wszyscy uczestnicy zgłoszą wyniki, serwer zapisuje `winner_player_id` (liczone są tylko wyniki poprawne i niepodejrzane)
- [ ] Panel moderatora: przegląd wyników z flagami (), odblokowanie lub usunięcie
- [ ] Zmiana adresu e-mail i usuwanie konta przez gracza

## Etap 3: monetyzacja z reklam (Google AdSense)

Decyzja: gra jest darmowa, a zarabia na reklamach. Płatne wpisowe i wypłaty wygranych odpadają, więc znika też problem z ustawą o grach hazardowych, KYC i portfelem.

### Zrobione w kodzie
- [x] Pas reklamowy na dole ekranu (`src/ads.ts`). Pokazuje się **tylko poza wyścigiem**: w menu, lobby, na wynikach i stronach informacyjnych. W trakcie biegu reklam nie ma.
- [x] Strony wymagane przez AdSense: Jak grać, O grze, Polityka prywatności, Kontakt (`src/pages.ts`) z odnośnikami w stopce menu.
- [x] Reklamy włączają się dopiero po ustawieniu zmiennych `VITE_ADSENSE_CLIENT` i `VITE_ADSENSE_SLOT`. Bez nich w grze nie ma żadnych reklam.

### Do zrobienia przez Ciebie (kolejność ma znaczenie)
1. **Kup domenę** (np. `clingydingy.pl`) i podepnij ją pod GitHub Pages: Settings → Pages → Custom domain. Do AdSense nie wystarczy adres `*.github.io`.
2. W Supabase zmień adresy logowania na nową domenę: `site_url` i `additional_redirect_urls` w `supabase/config.toml`, potem `npx supabase config push --yes`.
3. W `src/pages.ts` ustaw prawdziwy adres e-mail w `CONTACT_EMAIL`. Dane kontaktowe są wymagane w polityce prywatności.
4. Załóż konto na https://adsense.google.com, dodaj domenę i poczekaj na akceptację (od kilku dni do kilku tygodni). Google lubi witryny z treścią i ruchem, więc najpierw zbierz graczy.
5. W AdSense włącz **Prywatność i komunikaty** (baner zgody na cookies dla UE, certyfikowany przez Google). Bez zgód nie wolno wyświetlać reklam użytkownikom z EOG.
6. Po akceptacji: utwórz blok reklamowy (poziomy baner), skopiuj `ca-pub-…` i numer bloku, a w repo ustaw zmienne **VITE_ADSENSE_CLIENT** i **VITE_ADSENSE_SLOT** (Settings → Secrets and variables → Actions → Variables).
7. Dodaj plik `public/ads.txt` z linią od Google (`google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`).

### Pomysły na później
- **Reklamy z nagrodą** (np. obejrzyj reklamę, odblokuj skórkę): wymagają programu Google Ad Manager / H5 Games Ads i dobrze łączą się z konfiguratorem postaci.
- **Reklama pełnoekranowa** co 2–3 rundę, wyłącznie na ekranie wyników.
- Płatne usunięcie reklam albo skórki postaci jako mały zakup. Wymaga operatora płatności, ale to sprzedaż cyfrowych dóbr, a nie hazard.
- Zadbać o ruch: udostępnianie linku do pokoju, rewanże, ranking tygodniowy.

### Zasady
- Reklama nigdy nie może przesuwać ani zasłaniać ściany w trakcie biegu: liczy się czas i uczciwość rywalizacji.
- Zgody na cookies zbiera certyfikowany baner Google. Nie budujemy własnego.
