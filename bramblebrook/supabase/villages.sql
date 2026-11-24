-- Applied to the Bramblebrook project on 2026-11-24 as migration "villages".
-- Villages: players pool coins in a treasury, elders raise buildings, every member gets the perks.
-- All changes go through the functions below; tables are read-only to players.

create table public.village_building_defs (
  id text primary key,
  n text not null,
  blurb text not null,
  effect text not null,            -- the perk key the game applies (see 74-villages.js)
  per_level numeric not null,      -- perk amount per level
  max_level int not null,
  base_cost bigint not null,       -- cost of the first level
  growth numeric not null,         -- each level costs this much more than the last
  sort int not null
);
insert into public.village_building_defs (id, n, blurb, effect, per_level, max_level, base_cost, growth, sort) values
  ('hall',    'Town Hall',      'Room for 2 more neighbours each level. Every other building can only rise as high as the hall.', 'members', 2, 10, 2000, 2.0, 1),
  ('granary', 'Granary',        'Crops and fruit sell for 3% more each level.',                     'sell_crop',     3,    10, 1500, 1.8, 2),
  ('well',    'Village Well',   'Stamina refills 4% faster each level.',                           'regen',         4,    10, 1500, 1.8, 3),
  ('market',  'Seed Exchange',  'Seeds and shop goods cost 3% less each level.',                   'discount',      3,    10, 1500, 1.8, 4),
  ('smithy',  'Smithy',         'Mining and Crafting XP up 5% each level.',                        'xp_mine_craft', 5,    10, 2000, 1.8, 5),
  ('dock',    'Fishing Dock',   'Fishing XP up 5% each level.',                                    'xp_fishing',    5,    10, 2000, 1.8, 6),
  ('commons', 'Village Commons','Farming XP up 4% each level.',                                    'xp_farming',    4,    10, 2500, 1.8, 7),
  ('shrine',  'Moon Shrine',    'One more Inspiration at levels 3, 6 and 9.',                      'insp',          0.34, 9,  4000, 1.9, 8);

create table public.villages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 3 and 24),
  crest text not null default '🌾' check (char_length(crest) <= 8),
  motto text not null default '' check (char_length(motto) <= 80),
  open boolean not null default true,
  treasury bigint not null default 0 check (treasury >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.village_members (
  user_id uuid primary key references auth.users (id) on delete cascade,      -- one village per player
  village_id uuid not null references public.villages (id) on delete cascade,
  role text not null default 'member' check (role in ('elder', 'member')),
  contributed bigint not null default 0,
  joined_at timestamptz not null default now()
);
create index village_members_village on public.village_members (village_id);
create table public.village_buildings (
  village_id uuid not null references public.villages (id) on delete cascade,
  building text not null references public.village_building_defs (id),
  level int not null default 0,
  primary key (village_id, building)
);
create table public.village_log (
  id bigint generated always as identity primary key,
  village_id uuid not null references public.villages (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('chat', 'donate', 'build', 'join', 'leave', 'found', 'promote')),
  body text not null default '' check (char_length(body) <= 280),
  amount bigint,
  created_at timestamptz not null default now()
);
create index village_log_recent on public.village_log (village_id, created_at desc);

alter table public.village_building_defs enable row level security;
alter table public.villages enable row level security;
alter table public.village_members enable row level security;
alter table public.village_buildings enable row level security;
alter table public.village_log enable row level security;

create or replace function public.my_village() returns uuid
language sql security definer set search_path = '' stable as $$
  select village_id from public.village_members where user_id = auth.uid();
$$;

create policy "building list is public" on public.village_building_defs for select to authenticated using (true);
create policy "villages are listed for everyone" on public.villages for select to authenticated using (true);
create policy "rosters are public" on public.village_members for select to authenticated using (true);
create policy "buildings are public" on public.village_buildings for select to authenticated using (true);
create policy "members read their village board" on public.village_log for select to authenticated
  using (village_id = (select public.my_village()));

create or replace function public.village_cap(p_village uuid) returns int
language sql security definer set search_path = '' stable as $$
  select 10 + 2 * coalesce((select level from public.village_buildings where village_id = p_village and building = 'hall'), 0);
$$;

create or replace function public.create_village(p_name text, p_crest text, p_motto text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; n text := btrim(p_name);
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.village_members where user_id = auth.uid()) then raise exception 'You already belong to a village. Leave it first.'; end if;
  if char_length(n) < 3 or char_length(n) > 24 then raise exception 'Village names are 3 to 24 characters.'; end if;
  if exists (select 1 from public.villages where lower(name) = lower(n)) then raise exception 'That village name is taken.'; end if;
  insert into public.villages (name, crest, motto, created_by) values (n, coalesce(nullif(btrim(p_crest), ''), '🌾'), left(coalesce(btrim(p_motto), ''), 80), auth.uid()) returning id into v;
  insert into public.village_members (user_id, village_id, role) values (auth.uid(), v, 'elder');
  insert into public.village_buildings (village_id, building, level) select v, id, case when id = 'hall' then 1 else 0 end from public.village_building_defs;
  insert into public.village_log (village_id, user_id, kind, body) values (v, auth.uid(), 'found', 'founded the village');
  return v;
end $$;

create or replace function public.join_village(p_village uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.village_members where user_id = auth.uid()) then raise exception 'You already belong to a village. Leave it first.'; end if;
  perform 1 from public.villages where id = p_village and open for update;
  if not found then raise exception 'That village is not taking new neighbours.'; end if;
  if (select count(*) from public.village_members where village_id = p_village) >= public.village_cap(p_village) then raise exception 'That village is full.'; end if;
  insert into public.village_members (user_id, village_id) values (auth.uid(), p_village);
  insert into public.village_log (village_id, user_id, kind, body) values (p_village, auth.uid(), 'join', 'moved in');
end $$;

create or replace function public.leave_village() returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  delete from public.village_members where user_id = auth.uid() returning village_id into v;
  if v is null then return; end if;
  if not exists (select 1 from public.village_members where village_id = v) then
    delete from public.villages where id = v;
    return;
  end if;
  insert into public.village_log (village_id, user_id, kind, body) values (v, auth.uid(), 'leave', 'moved away');
  if not exists (select 1 from public.village_members where village_id = v and role = 'elder') then
    update public.village_members set role = 'elder'
    where user_id = (select user_id from public.village_members where village_id = v order by joined_at limit 1);
  end if;
end $$;

-- the game takes the coins from the player's farm first; the server caps a single gift
create or replace function public.donate_to_village(p_amount bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v uuid; t bigint;
begin
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then raise exception 'Give between 1 and 100,000,000 coins.'; end if;
  update public.villages set treasury = treasury + p_amount where id = v returning treasury into t;
  update public.village_members set contributed = contributed + p_amount where user_id = auth.uid();
  insert into public.village_log (village_id, user_id, kind, body, amount) values (v, auth.uid(), 'donate', 'gave coins', p_amount);
  return t;
end $$;

create or replace function public.upgrade_village_building(p_building text) returns int
language plpgsql security definer set search_path = '' as $$
declare v uuid; d public.village_building_defs; lv int; hall int; cost bigint;
begin
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if (select role from public.village_members where user_id = auth.uid()) <> 'elder' then raise exception 'Only elders can spend the treasury.'; end if;
  select * into d from public.village_building_defs where id = p_building;
  if not found then raise exception 'Unknown building.'; end if;
  perform 1 from public.villages where id = v for update;
  select level into lv from public.village_buildings where village_id = v and building = p_building;
  lv := coalesce(lv, 0);
  select level into hall from public.village_buildings where village_id = v and building = 'hall';
  if lv >= d.max_level then raise exception 'That building is as big as it gets.'; end if;
  if p_building <> 'hall' and lv >= coalesce(hall, 0) then raise exception 'Raise the Town Hall first.'; end if;
  cost := round(d.base_cost * power(d.growth, lv));
  if (select treasury from public.villages where id = v) < cost then raise exception 'The treasury is short.'; end if;
  update public.villages set treasury = treasury - cost where id = v;
  insert into public.village_buildings (village_id, building, level) values (v, p_building, lv + 1)
    on conflict (village_id, building) do update set level = excluded.level;
  insert into public.village_log (village_id, user_id, kind, body, amount) values (v, auth.uid(), 'build', d.n || ' to level ' || (lv + 1), cost);
  return lv + 1;
end $$;

create or replace function public.post_village_message(p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid; b text := btrim(p_body);
begin
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if char_length(b) < 1 or char_length(b) > 280 then raise exception 'Messages are 1 to 280 characters.'; end if;
  if exists (select 1 from public.village_log where village_id = v and user_id = auth.uid() and kind = 'chat' and created_at > now() - interval '3 seconds') then
    raise exception 'Slow down a little.';
  end if;
  insert into public.village_log (village_id, user_id, kind, body) values (v, auth.uid(), 'chat', b);
end $$;

create or replace function public.promote_village_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  v := public.my_village();
  if v is null or (select role from public.village_members where user_id = auth.uid()) <> 'elder' then raise exception 'Only elders can do that.'; end if;
  update public.village_members set role = 'elder' where user_id = p_user and village_id = v;
  if found then insert into public.village_log (village_id, user_id, kind, body) values (v, p_user, 'promote', 'became an elder'); end if;
end $$;

create or replace function public.set_village_details(p_motto text, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  v := public.my_village();
  if v is null or (select role from public.village_members where user_id = auth.uid()) <> 'elder' then raise exception 'Only elders can do that.'; end if;
  update public.villages set motto = left(coalesce(btrim(p_motto), ''), 80), open = coalesce(p_open, open) where id = v;
end $$;

-- the village list with head counts, for finding one to join
create or replace function public.list_villages() returns table (id uuid, name text, crest text, motto text, open boolean, members int, cap int, hall int)
language sql security definer set search_path = '' stable as $$
  select v.id, v.name, v.crest, v.motto, v.open,
         (select count(*)::int from public.village_members m where m.village_id = v.id),
         public.village_cap(v.id),
         coalesce((select level from public.village_buildings b where b.village_id = v.id and b.building = 'hall'), 0)
  from public.villages v where auth.uid() is not null
  order by 6 desc, v.created_at limit 50;
$$;

do $$
declare f text;
begin
  foreach f in array array['my_village()', 'village_cap(uuid)', 'create_village(text, text, text)', 'join_village(uuid)', 'leave_village()',
    'donate_to_village(bigint)', 'upgrade_village_building(text)', 'post_village_message(text)', 'promote_village_member(uuid)',
    'set_village_details(text, boolean)', 'list_villages()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
