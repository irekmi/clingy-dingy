-- Solo run: a match may have a single player (the server still creates it, so the result is verified
-- and can reach the global ranking like any other).
alter table public.matches drop constraint if exists matches_players_check;
alter table public.matches add constraint matches_players_check check (cardinality(players) between 1 and 6);
