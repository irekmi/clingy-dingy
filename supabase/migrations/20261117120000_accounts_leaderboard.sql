-- Etap 2a: konta graczy (Supabase Auth, e-mail + hasło), profile z nickiem i ranking najlepszych czasów.

-- Profil gracza: 1:1 z auth.users. Nick jest unikalny (bez rozróżniania wielkości liter).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nick        text not null check (char_length(nick) between 1 and 16),
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_nick_unique on public.profiles (lower(nick));

alter table public.profiles enable row level security;

create policy "profiles: odczyt publiczny"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "profiles: gracz zmienia swój nick"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Profil zakładany automatycznie przy rejestracji. Nick z metadanych rejestracji;
-- jeśli zajęty – dopisujemy losowe cyfry.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'nick'), ''), 'Gracz'), 12);
  candidate text := base;
begin
  while exists (select 1 from public.profiles where lower(nick) = lower(candidate)) loop
    candidate := base || floor(random() * 9000 + 1000)::int;
  end loop;
  insert into public.profiles (id, nick) values (new.id, candidate);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Wyniki: powiązanie z kontem (null = gość – nie trafia do rankingu).
alter table public.race_results
  add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists race_results_user_best on public.race_results (user_id, verified_ms) where valid;

-- Ranking ogólny: najlepszy zweryfikowany czas każdego zalogowanego gracza.
drop view if exists public.leaderboard;
create view public.leaderboard
  with (security_invoker = true) as
  select p.nick, b.user_id, b.best_ms, b.achieved_at
  from (
    select distinct on (user_id) user_id, verified_ms as best_ms, created_at as achieved_at
    from public.race_results
    where valid and user_id is not null
    order by user_id, verified_ms asc, created_at asc
  ) b
  join public.profiles p on p.id = b.user_id
  order by b.best_ms asc
  limit 100;

grant select on public.leaderboard to anon, authenticated;
