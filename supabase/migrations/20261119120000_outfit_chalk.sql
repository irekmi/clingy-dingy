-- Etap 3: strój postaci, waluta "chalk" za wygrane w pokojach, cieszynki (kupowane za chalk).
-- Saldo zmienia wyłącznie serwer: nagroda w decide_match (wołane przez Edge Function), zakup w buy_celebration.

-- 1) profil: strój, saldo, założona cieszynka
alter table public.profiles
  add column if not exists outfit jsonb,
  add column if not exists chalk integer not null default 0 check (chalk >= 0),
  add column if not exists celebration text not null default 'clap'
    check (celebration in ('clap', 'chalk', 'flex', 'disco', 'flip'));

-- te same wartości co OUTFIT_OPTIONS w src/game/render.ts
create or replace function public.valid_outfit(o jsonb) returns boolean
language sql immutable as $$
  select o is null or (
    jsonb_typeof(o) = 'object' and
    o ->> 'skin'      in ('#f0c9a4', '#d39a62', '#a8693d', '#7a4a2b') and
    o ->> 'hairStyle' in ('short', 'pony', 'curly', 'long') and
    o ->> 'hair'      in ('#1d1a18', '#5a3a24', '#c9a04a', '#a5462a') and
    coalesce(o ->> 'band', 'none') in ('none', '#e5484d', '#2563a8', '#f2c94c') and
    o ->> 'shirt'     in ('#2563a8', '#e2672f', '#2f9e5a', '#7c4dbd') and
    o ->> 'pants'     in ('#2b3150', '#2b2b33', '#1f4f8a', '#c9b28a') and
    o ->> 'shoes'     in ('#f2b233', '#e5484d', '#5b8fd1', '#f4f1e8')
  )
$$;
alter table public.profiles drop constraint if exists profiles_outfit_valid;
alter table public.profiles add constraint profiles_outfit_valid check (public.valid_outfit(outfit));

-- 2) uprawnienia do kolumn: wszyscy czytają nick, strój i cieszynkę (NIE saldo),
--    gracz zmienia tylko swój nick i strój (wiersz ogranicza istniejąca polityka RLS)
revoke select, insert, update, delete on public.profiles from anon, authenticated;
grant select (id, nick, created_at, outfit, celebration) on public.profiles to anon, authenticated;
grant update (nick, outfit) on public.profiles to authenticated;

-- 3) posiadane cieszynki ('clap' jest darmowa i nie ma wiersza)
create table if not exists public.owned_celebrations (
  user_id     uuid not null references auth.users (id) on delete cascade,
  celebration text not null check (celebration in ('chalk', 'flex', 'disco', 'flip')),
  acquired_at timestamptz not null default now(),
  primary key (user_id, celebration)
);
alter table public.owned_celebrations enable row level security;
revoke all on public.owned_celebrations from anon, authenticated;
grant select on public.owned_celebrations to authenticated;
create policy "owned_celebrations: gracz widzi swoje"
  on public.owned_celebrations for select to authenticated
  using (auth.uid() = user_id);

-- 4) księga operacji: audyt + jedna nagroda za mecz
create table if not exists public.chalk_ledger (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  delta      integer not null,
  reason     text not null check (reason in ('win', 'purchase', 'admin')),
  match_id   uuid,
  item       text,
  created_at timestamptz not null default now()
);
create unique index if not exists chalk_ledger_one_win_per_match on public.chalk_ledger (match_id) where reason = 'win';
create index if not exists chalk_ledger_user on public.chalk_ledger (user_id, created_at desc);
alter table public.chalk_ledger enable row level security;
revoke all on public.chalk_ledger from anon, authenticated;
grant select on public.chalk_ledger to authenticated;
create policy "chalk_ledger: gracz widzi swoje"
  on public.chalk_ledger for select to authenticated
  using (auth.uid() = user_id);

-- 5) mój portfel: saldo, założona i posiadane cieszynki
create or replace function public.my_wallet()
returns table (chalk integer, celebration text, owned text[])
language sql stable security definer set search_path = public as $$
  select p.chalk, p.celebration,
    coalesce((select array_agg(o.celebration order by o.acquired_at) from owned_celebrations o where o.user_id = p.id), '{}')
  from profiles p
  where p.id = auth.uid()
$$;

-- 6) zakup cieszynki (atomowo, z blokadą wiersza); od razu ją zakłada; zwraca nowe saldo
create or replace function public.buy_celebration(item text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  price constant integer := 200;
  bal integer;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  if item not in ('chalk', 'flex', 'disco', 'flip') then raise exception 'unknown_item'; end if;
  select p.chalk into bal from profiles p where p.id = auth.uid() for update;
  if bal is null then raise exception 'no_profile'; end if;
  if exists (select 1 from owned_celebrations where user_id = auth.uid() and celebration = item) then
    raise exception 'already_owned';
  end if;
  if bal < price then raise exception 'not_enough_chalk'; end if;
  update profiles set chalk = chalk - price, celebration = item where id = auth.uid();
  insert into owned_celebrations (user_id, celebration) values (auth.uid(), item);
  insert into chalk_ledger (user_id, delta, reason, item) values (auth.uid(), -price, 'purchase', item);
  return bal - price;
end $$;

-- 7) założenie posiadanej cieszynki
create or replace function public.equip_celebration(item text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  if item <> 'clap' and not exists (select 1 from owned_celebrations where user_id = auth.uid() and celebration = item) then
    raise exception 'not_owned';
  end if;
  update profiles set celebration = item where id = auth.uid();
end $$;

-- 8) rozstrzygnięcie meczu + nagroda (raz na mecz). Wołane tylko przez Edge Function submit-result.
--    Nagroda: zwycięzca zalogowany, wynik poprawny i niepodejrzany, co najmniej 2 takie wyniki w meczu.
create or replace function public.decide_match(p_match uuid)
returns table (winner_user uuid, amount integer)
language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
  v_user uuid;
  n integer;
  amt integer := 0;
begin
  update matches set finished_at = now() where id = p_match and finished_at is null;
  if not found then return; end if; -- już rozstrzygnięty (albo nie istnieje)
  select count(*) into n from race_results
    where match_id = p_match and valid and not suspect and verified_ms is not null;
  select r.player_id, r.user_id into v_player, v_user from race_results r
    where r.match_id = p_match and r.valid and not r.suspect and r.verified_ms is not null
    order by r.verified_ms asc, r.created_at asc limit 1;
  update matches set winner_player_id = v_player where id = p_match;
  if v_user is not null and n >= 2 then
    amt := 10 + 5 * (n - 2);
    insert into chalk_ledger (user_id, delta, reason, match_id) values (v_user, amt, 'win', p_match)
      on conflict do nothing;
    if found then
      update profiles set chalk = chalk + amt where id = v_user;
    else
      amt := 0;
    end if;
  end if;
  return query select v_user, amt;
end $$;

-- mecze, w których ktoś wyszedł przed metą (nigdy nie zgłosi wyniku): rozstrzygamy je po 3 minutach
create or replace function public.close_stale_matches() returns integer
language plpgsql security definer set search_path = public as $$
declare
  m record;
  k integer := 0;
begin
  for m in
    select id from matches
    where finished_at is null and created_at < now() - interval '3 minutes' and created_at > now() - interval '2 days'
    order by created_at limit 25
  loop
    perform public.decide_match(m.id);
    k := k + 1;
  end loop;
  return k;
end $$;

revoke all on function public.my_wallet() from public, anon;
revoke all on function public.buy_celebration(text) from public, anon;
revoke all on function public.equip_celebration(text) from public, anon;
grant execute on function public.my_wallet() to authenticated;
grant execute on function public.buy_celebration(text) to authenticated;
grant execute on function public.equip_celebration(text) to authenticated;
revoke all on function public.decide_match(uuid) from public, anon, authenticated;
revoke all on function public.close_stale_matches() from public, anon, authenticated;
grant execute on function public.decide_match(uuid) to service_role;
grant execute on function public.close_stale_matches() to service_role;

-- 9) ranking wygranych (z księgi: dokładnie te wygrane, które dały chalk)
drop view if exists public.leaderboard_wins;
create view public.leaderboard_wins as
  select l.user_id, p.nick, p.outfit, count(*)::integer as wins
  from public.chalk_ledger l
  join public.profiles p on p.id = l.user_id
  where l.reason = 'win'
  group by l.user_id, p.nick, p.outfit
  order by wins desc, min(l.created_at) asc
  limit 100;
grant select on public.leaderboard_wins to anon, authenticated;
