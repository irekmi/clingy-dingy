-- Etap 1: wyniki wyścigów, zapisywane WYŁĄCZNIE przez Edge Function "submit-result"
-- (ona odtwarza bieg z logu wciśnięć i liczy zweryfikowany czas).

create table if not exists public.race_results (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  match_id     uuid not null,
  room_code    text not null check (room_code ~ '^[A-Z0-9]{4,8}$'),
  player_id    uuid not null,
  nick         text not null check (char_length(nick) between 1 and 16),
  claimed_ms   integer not null check (claimed_ms >= 0),
  verified_ms  integer,
  valid        boolean not null,
  perfects     integer not null default 0,
  goods        integer not null default 0,
  errors       integer not null default 0,
  inputs       jsonb not null,
  unique (match_id, player_id)
);

create index if not exists race_results_best on public.race_results (verified_ms) where valid;

-- RLS: przeglądarka może tylko CZYTAĆ. Brak polityk insert/update/delete = brak zapisu z klienta.
-- Edge Function używa klucza service_role, który omija RLS.
alter table public.race_results enable row level security;

create policy "race_results: odczyt publiczny"
  on public.race_results for select
  to anon, authenticated
  using (true);

-- Ranking najlepszych zweryfikowanych czasów
create or replace view public.leaderboard
  with (security_invoker = true) as
  select nick, verified_ms as best_ms, created_at
  from public.race_results
  where valid
  order by verified_ms asc
  limit 100;
