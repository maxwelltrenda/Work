-- Step 2 of the server-run economy: the server's copy of each farm is the real one.
-- The sync edge function replays a player's moves through the game's own rules and saves the result here,
-- through svc_farm_save(), which in one transaction also marks server-issued rewards used and pays village gifts.
-- saves stays as a read copy (profiles, the farm picker, the Claude connector); only the server writes it now.

create table if not exists public.farms (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  hash text not null,
  last_t bigint not null default 0,          -- time of the latest move applied (ms)
  v int not null default 1,                  -- bumps on every save; a save from an older read is refused
  seqs jsonb not null default '{}'::jsonb,   -- per device: the last move number applied, so a resent move is not applied twice
  build text,
  origin text,                               -- where the farm first came from: saves, start, fresh, reset
  updated_at timestamptz not null default now(),
  constraint farms_size check (octet_length(state::text) <= 2000000)
);
alter table public.farms enable row level security;
revoke all on public.farms from anon, authenticated;

-- rewards the server hands out (village boss shares); the farm takes each one once
create table if not exists public.farm_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  coins int not null default 0 check (coins >= 0),
  xp int not null default 0 check (xp >= 0),
  ref text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists farm_grants_open on public.farm_grants (user_id) where applied_at is null;
alter table public.farm_grants enable row level security;
revoke all on public.farm_grants from anon, authenticated;

create or replace function public.svc_farm_save(p_user uuid, p_v int, p_state jsonb, p_hash text, p_last bigint, p_seqs jsonb,
  p_build text, p_origin text, p_grants bigint[], p_gift bigint, p_summary jsonb, p_device text)
returns int language plpgsql security definer set search_path = '' as $$
declare nv int; n int; vill uuid;
begin
  if p_v = 0 then
    insert into public.farms (user_id, state, hash, last_t, v, seqs, build, origin)
      values (p_user, p_state, p_hash, p_last, 1, coalesce(p_seqs, '{}'::jsonb), p_build, p_origin)
      on conflict (user_id) do nothing;
    if not found then return 0; end if;
    nv := 1;
  else
    update public.farms set state = p_state, hash = p_hash, last_t = p_last, v = v + 1, seqs = coalesce(p_seqs, '{}'::jsonb),
      build = p_build, origin = coalesce(p_origin, origin), updated_at = now()
      where user_id = p_user and v = p_v returning v into nv;
    if nv is null then return 0; end if;
  end if;
  if coalesce(array_length(p_grants, 1), 0) > 0 then
    update public.farm_grants set applied_at = now() where user_id = p_user and id = any(p_grants) and applied_at is null;
    get diagnostics n = row_count;
    if n <> array_length(p_grants, 1) then raise exception 'farm_grant_taken'; end if;   -- undoes the farm write too
  end if;
  if coalesce(p_gift, 0) > 0 then
    select village_id into vill from public.village_members where user_id = p_user;
    if vill is null then raise exception 'farm_no_village'; end if;
    update public.villages set treasury = treasury + p_gift where id = vill;
    update public.village_members set contributed = contributed + p_gift where user_id = p_user;
    insert into public.village_log (village_id, user_id, kind, body, amount) values (vill, p_user, 'donate', 'gave coins', p_gift);
  end if;
  insert into public.saves (user_id, data, summary, device) values (p_user, p_state, coalesce(p_summary, '{}'::jsonb), left(coalesce(p_device, ''), 60))
    on conflict (user_id) do update set data = excluded.data, summary = excluded.summary, device = excluded.device;
  return nv;
end $$;
revoke all on function public.svc_farm_save(uuid, int, jsonb, text, bigint, jsonb, text, text, bigint[], bigint, jsonb, text) from public, anon, authenticated;

-- the village perks the rules use, from the village's real buildings (the same shape the game keeps)
create or replace function public.svc_farm_village(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when m.village_id is null then null else jsonb_build_object(
    'levels', coalesce((select jsonb_object_agg(b.building, b.level) from public.village_buildings b where b.village_id = m.village_id), '{}'::jsonb),
    'defs', coalesce((select jsonb_object_agg(d.id, jsonb_build_object('effect', d.effect, 'per_level', d.per_level)) from public.village_building_defs d), '{}'::jsonb),
    'name', (select v.name from public.villages v where v.id = m.village_id)) end
  from (select (select village_id from public.village_members where user_id = p_user) as village_id) m;
$$;
revoke all on function public.svc_farm_village(uuid) from public, anon, authenticated;

-- a boss share is paid into the farm by the server, not added by the phone
create or replace function public.claim_raid_reward() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; rw jsonb; gid bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v := public.my_village();
  if v is not null then perform public.raid_settle(v); end if;
  select to_jsonb(x) into rw from (
    select h.raid_id, d.n as boss_name, rr.status, h.actions,
      (h.actions * d.coin_per_action * case when rr.status = 'won' then 1 else 0.5 end
        + case when rr.status = 'won' and h.actions >= 3 then d.victory_bonus else 0 end)::int as coins,
      (h.actions * 15 * case when rr.status = 'won' then 1 else 0.5 end)::int as xp
    from public.raid_hits h join public.village_raids rr on rr.id = h.raid_id join public.raid_boss_defs d on d.id = rr.boss
    where h.user_id = auth.uid() and not h.claimed and rr.status <> 'active'
    order by rr.done_at desc limit 1) x;
  if rw is null then raise exception 'Nothing to collect yet.'; end if;
  update public.raid_hits set claimed = true where raid_id = (rw->>'raid_id')::bigint and user_id = auth.uid() and not claimed;
  if not found then raise exception 'Already collected.'; end if;
  insert into public.farm_grants (user_id, kind, coins, xp, ref)
    values (auth.uid(), 'raid', greatest(0, (rw->>'coins')::int), greatest(0, (rw->>'xp')::int), rw->>'raid_id') returning id into gid;
  return rw || jsonb_build_object('grant', gid);
end $$;

-- giving coins happens inside the farm now (a 'pay' move the server plays), so the old way in is closed
create or replace function public.donate_to_village(p_amount bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Please reload the game to give coins.';
end $$;

-- applied once the new game was live: the browser can read its farm's copy but never write one
revoke insert, update on public.saves from authenticated, anon;
