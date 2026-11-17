# Patyczaki – wspinaczka 1 na 1

Szybka przeglądarkowa gra dla dwóch osób. Ekran jest podzielony na pół: po lewej wspinasz się Ty, po prawej na żywo widzisz przeciwnika. Wygrywa ten, kto szybciej dotrze na szczyt według **swojego lokalnego timera**, więc lagi nie wpływają na wynik.

**Sterowanie (rytm):** na następnym chwycie zaciska się pierścień. Gdy się zamknie, wciśnij strzałkę strony chwytu: `←`/`A` albo `→`/`D`. Na telefonie dotknij lewej lub prawej połowy swojego ekranu.

| Trafienie | Efekt |
|---|---|
| PERFEKT (±50 ms) | wchodzisz wyżej, tempo przyspiesza (combo) |
| OK (±120 ms) | wchodzisz wyżej |
| za wcześnie | krótka przerwa, tempo od nowa |
| zła ręka | ześlizg o chwyt w dół |

## Architektura

```
GitHub Pages (statyczny frontend: Vite + TypeScript + Canvas)
        │  WebSocket
        ▼
Supabase Realtime ── pokój "room-KOD": Presence (kto jest, kto gotowy) + Broadcast (start, pozycja, meta)
Supabase Edge Function "submit-result" ── odtwarza bieg z logu wciśnięć i zapisuje zweryfikowany czas
Supabase Postgres ── tabela race_results (+ widok leaderboard)
```

Jak działa uczciwy lokalny timer:

1. Host wysyła `start` z losowym `matchId`. Z niego obaj gracze generują identyczną trasę.
2. Każdy klient odlicza 3 s **lokalnie** i mierzy swój czas od własnego sygnału START.
3. Każde wciśnięcie trafia do logu `[czas_ms, strona]`. Wynik to czas z symulacji ([`sim.ts`](supabase/functions/_shared/sim.ts)), a nie dowolna liczba, którą można podmienić.
4. Na mecie log trafia do przeciwnika (sprawdza go u siebie) i do Edge Function (sprawdza go serwer). Ten sam plik `sim.ts` działa w przeglądarce i na serwerze, więc zmanipulowany wynik nie przejdzie.

## Uruchomienie lokalne

```bash
npm install
```

```bash
npm run dev
```

Bez pliku `.env.local` gra działa w **trybie lokalnym**: utwórz pokój i otwórz ten sam link w **drugim oknie** tej samej przeglądarki. Ustaw okna obok siebie, bo karta w tle nie rysuje animacji.

Testy logiki gry:

```bash
npm test
```

## Krok po kroku: Supabase (gra przez internet)

1. Na [supabase.com](https://supabase.com) utwórz projekt (**New project**), najlepiej w regionie Frankfurt (`eu-central-1`).
2. **Project Settings → API**: skopiuj *Project URL* i klucz **publishable** (albo *anon*). Utwórz plik `.env.local` na wzór [.env.example](.env.example).
3. Załóż tabelę. Masz dwie możliwości:
   - wklej zawartość [`supabase/migrations/20261117000000_init.sql`](supabase/migrations/20261117000000_init.sql) w **SQL Editor** i kliknij *Run*, **albo**
   - użyj CLI:
     ```bash
     npx supabase login
     ```
     ```bash
     npx supabase link --project-ref TWOJ_PROJECT_REF
     ```
     ```bash
     npx supabase db push
     ```
4. Wdróż funkcję weryfikującą wyniki (wymaga kroku `link` powyżej):
   ```bash
   npx supabase functions deploy submit-result
   ```
5. **Realtime → Settings**: upewnij się, że opcja *Allow public access* jest włączona (gra używa publicznych kanałów).
6. Uruchom `npm run dev`. W menu powinien pojawić się napis „Online: Supabase Realtime ✔”. Od teraz możecie grać z dwóch różnych przeglądarek i komputerów.

> Klucz publishable/anon jest publiczny i trafia do przeglądarki. Tak ma być, bo bezpieczeństwo zapewniają RLS i Edge Function. **Nigdy** nie umieszczaj w repo ani we froncie klucza `secret` / `service_role`.

## Krok po kroku: publikacja na GitHub Pages

1. Na GitHubie utwórz nowe repo, np. `patyczaki-wspinaczka`, i wypchnij kod:
   ```bash
   git remote add origin https://github.com/TWOJ_LOGIN/patyczaki-wspinaczka.git
   ```
   ```bash
   git push -u origin main
   ```
2. W repo: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → zakładka Variables**: dodaj `VITE_SUPABASE_URL` i `VITE_SUPABASE_KEY`.
4. Każdy push na `main` buduje i publikuje grę pod adresem `https://TWOJ_LOGIN.github.io/patyczaki-wspinaczka/`. Workflow znajdziesz w [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Struktura

```
src/main.ts                 – przebieg meczu: lobby, odliczanie, wyścig, wyniki
src/game/render.ts          – rysowanie ściany i patyczaka (Canvas)
src/net/transport.ts        – wspólny interfejs pokoju
src/net/supabase.ts         – Supabase Realtime + wywołanie Edge Function
src/net/localTransport.ts   – tryb testowy (BroadcastChannel)
supabase/functions/_shared/sim.ts      – deterministyczna symulacja (klient + serwer)
supabase/functions/submit-result/      – weryfikacja i zapis wyniku
supabase/migrations/                   – schemat bazy
tests/sim.test.ts           – testy symulacji
docs/ROADMAP.md             – kolejne etapy, w tym płatności
```

Plan dalszych prac i uwagi o płatnościach: [docs/ROADMAP.md](docs/ROADMAP.md).
