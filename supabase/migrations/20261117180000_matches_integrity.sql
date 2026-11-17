-- Etap 2b: mecze tworzone na serwerze, flagi podejrzanych wyników, rozstrzyganie zwycięzcy, historia gracza.

-- Mecz zakłada wyłącznie Edge Function "create-match" (klucz service_role omija RLS).
-- Dzięki temu wynik da się zgłosić tylko do meczu, który naprawdę się odbył, i tylko dla jego uczestników.
create table if not exists public.matches (
  id                uuid primary key,
  room_code         text not null check (room_code ~ '^[A-Z0-9]{4,8}$'),
  players           uuid[] not null check (cardinality(players) between 2 and 6),
  created_at        timestamptz not null default now(),
  finished_at       timestamptz,
  winner_player_id  uuid
);
create index if not exists matches_room_recent on public.matches (room_code, created_at desc);

alter table public.matches enable row level security;
create policy "matches: odczyt publiczny"
  on public.matches for select
  to anon, authenticated
  using (true);

-- Wynik oznaczony jako podejrzany (zbyt idealne trafienia, zbyt szybki bieg, brak meczu na serwerze)
-- zostaje zapisany do przeglądu, ale nie trafia do rankingu.
alter table public.race_results
  add column if not exists suspect boolean not null default false,
  add column if not exists flags text[] not null default '{}';

-- Ranking ogólny pomija wyniki podejrzane.
drop view if exists public.leaderboard;
create view public.leaderboard
  with (security_invoker = true) as
  select p.nick, b.user_id, b.best_ms, b.achieved_at
  from (
    select distinct on (user_id) user_id, verified_ms as best_ms, created_at as achieved_at
    from public.race_results
    where valid and not suspect and user_id is not null
    order by user_id, verified_ms asc, created_at asc
  ) b
  join public.profiles p on p.id = b.user_id
  order by b.best_ms asc
  limit 100;
grant select on public.leaderboard to anon, authenticated;

-- Historia zalogowanego gracza (widzi tylko swoje wiersze).
drop view if exists public.my_results;
create view public.my_results
  with (security_invoker = true) as
  select
    r.created_at,
    r.match_id,
    r.room_code,
    r.verified_ms,
    r.valid,
    r.suspect,
    r.perfects,
    r.errors,
    (m.winner_player_id is not null and m.winner_player_id = r.player_id) as won,
    coalesce(cardinality(m.players), 0) as players
  from public.race_results r
  left join public.matches m on m.id = r.match_id
  where r.user_id = auth.uid();
grant select on public.my_results to authenticated;
