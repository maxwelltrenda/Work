-- Applied to the Bramblebrook project on 2026-11-24 as migration "profiles_presence".
-- Public player profiles, online status and privacy.
alter table public.profiles
  add column public jsonb not null default '{}'::jsonb,         -- what others see: character name, portrait, levels, title
  add column show_online boolean not null default true,         -- "Show when I'm online"
  add column last_seen timestamptz;

-- Players read only their own row directly; everyone else goes through the functions below,
-- which hide last_seen when a player keeps their status private. A restrictive policy is ANDed with the
-- older "readable by signed-in players" one, so together they allow only your own row.
create policy "players read only their own profile" on public.profiles
  as restrictive for select to authenticated using ((select auth.uid()) = id);

-- only these columns can be changed by the player (never the username)
revoke update on public.profiles from authenticated, anon;
grant update (farm_name, public, show_online) on public.profiles to authenticated;

create or replace function public.touch_presence() returns timestamptz
language sql security definer set search_path = '' as $$
  update public.profiles set last_seen = now() where id = auth.uid() returning last_seen;
$$;

-- one shape for every profile another player can see
create or replace function public.get_profiles(p_ids uuid[])
returns table (id uuid, username text, farm_name text, public jsonb, online boolean, last_seen timestamptz, hidden boolean)
language sql security definer set search_path = '' stable as $$
  select p.id, p.username, p.farm_name, p.public,
         (p.show_online or p.id = auth.uid()) and p.last_seen > now() - interval '5 minutes' as online,
         case when p.show_online or p.id = auth.uid() then p.last_seen end as last_seen,
         not p.show_online and p.id <> auth.uid() as hidden
  from public.profiles p
  where p.id = any (p_ids) and auth.uid() is not null;
$$;

create or replace function public.find_profile(p_username text)
returns table (id uuid, username text, farm_name text, public jsonb, online boolean, last_seen timestamptz, hidden boolean)
language sql security definer set search_path = '' stable as $$
  select * from public.get_profiles(array(select p.id from public.profiles p where p.username = lower(trim(p_username))));
$$;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.get_profiles(uuid[]) from public, anon;
revoke all on function public.find_profile(text) from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.get_profiles(uuid[]) to authenticated;
grant execute on function public.find_profile(text) to authenticated;

