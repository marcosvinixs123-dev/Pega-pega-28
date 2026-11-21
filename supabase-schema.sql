-- pega28 · Etapas 1 e 2 · cole tudo no SQL Editor do Supabase e toque em Run.

create table public.games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (char_length(code) = 6),
  host_id uuid not null default auth.uid(),
  status text not null default 'lobby',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  nickname text not null check (char_length(nickname) between 1 and 20),
  team text check (team in ('cacador','fugitivo')),
  created_at timestamptz not null default now(),
  unique (game_id, user_id)
);

alter table public.games enable row level security;
alter table public.players enable row level security;

-- função auxiliar: "eu estou nesta partida?" (evita recursão nas regras)
create function public.in_game(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players where game_id = gid and user_id = auth.uid());
$$;

-- games: qualquer usuário logado acha a partida pelo código; só o anfitrião altera/apaga
create policy games_select on public.games for select to authenticated using (true);
create policy games_insert on public.games for insert to authenticated with check (host_id = auth.uid());
create policy games_update on public.games for update to authenticated using (host_id = auth.uid());
create policy games_delete on public.games for delete to authenticated using (host_id = auth.uid());

-- players: só quem está na partida vê os outros jogadores
create policy players_select on public.players for select to authenticated using (public.in_game(game_id));
create policy players_insert on public.players for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.games g where g.id = game_id and g.status = 'lobby'));
create policy players_delete on public.players for delete to authenticated using (user_id = auth.uid());
create policy players_update_host on public.players for update to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.host_id = auth.uid()));

-- tempo real
alter publication supabase_realtime add table public.games, public.players;
