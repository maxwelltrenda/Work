-- The boss ladder and battle gear (Jarldoms' Sagas and wargear, brought to the valley). Applied as migration "boss_ladder";
-- the rows (tiers, bosses of tiers 2-10, gear) are in boss_ladder_seed.sql, written by tools/boss_ladder.py.
--   Ten tiers, lowest to highest. Tier 1 is the first four bosses; a tier opens once the village has beaten every
--   boss in the tier below (start_raid). Within a tier any boss can be summoned.
--   Every claimed share now also pays Battle Runes (2 a tier for a win, 1 a tier for a loss) and battle experience
--   by tier (15 + 4 a tier per attack). A win with 3+ attacks may drop a piece of that tier's gear: chance and the
--   win that is sure to drop come from raid_tiers, counted per player per tier (raid_gear_pity).
--   Gear worn on the farm (farms.state.gear, enchant levels in farms.state.gearLv) makes hits harder:
--   raid_gear_bonus, added to the farmhand bonus, under the same 500 cap. The farm is the server's own copy,
--   so what is worn and owned can be trusted.

create table if not exists public.raid_tiers (
  tier int primary key, n text not null, blurb text not null default '',
  drop_chance numeric not null check (drop_chance > 0 and drop_chance <= 1), pity int not null check (pity >= 1));
alter table public.raid_tiers enable row level security;
revoke all on public.raid_tiers from anon, authenticated;

alter table public.raid_boss_defs add column if not exists tier int not null default 1;

create table if not exists public.raid_gear_defs (
  id text primary key, tier int not null, slot text not null check (slot in ('weapon', 'offhand', 'head', 'body', 'feet', 'cloak')),
  bar text not null check (bar in ('might', 'magic', 'both')), raid int not null check (raid >= 0));
alter table public.raid_gear_defs enable row level security;
revoke all on public.raid_gear_defs from anon, authenticated;

create table if not exists public.raid_gear_pity (
  user_id uuid not null references auth.users(id) on delete cascade, tier int not null, misses int not null default 0,
  primary key (user_id, tier));
alter table public.raid_gear_pity enable row level security;
revoke all on public.raid_gear_pity from anon, authenticated;

-- items a reward carries into the farm ({"boss_rune": 4, "gear_bramble...": 1}); the farm adds them when it takes the grant
alter table public.farm_grants add column if not exists items jsonb;

-- % more damage (as a fraction) from the gear a player wears, for a Strike ('might') or Cast ('magic') attack
create or replace function public.raid_gear_bonus(p_user uuid, p_kind text) returns numeric
language sql stable security definer set search_path = '' as $$
  with st as (select f.state from public.farms f where f.user_id = p_user),
  worn as (
    select g.id, g.tier, g.bar, g.raid,
      least(5, greatest(0, case when jsonb_typeof(st.state->'gearLv'->g.id) = 'number' then floor((st.state->'gearLv'->>g.id)::numeric)::int else 0 end)) as lv
    from st cross join lateral jsonb_each_text(case when jsonb_typeof(st.state->'gear') = 'object' then st.state->'gear' else '{}'::jsonb end) w(slot, item)
    join public.raid_gear_defs g on g.id = w.item and g.slot = w.slot
    where jsonb_typeof(st.state->'inv'->g.id) = 'number' and (st.state->'inv'->>g.id)::numeric > 0)
  select (coalesce((select sum(raid * (case when bar = 'both' or bar = p_kind then 1 else 0.5 end) * (1 + lv * 0.10)) from worn), 0)
    + 10 * (select count(*) from (select tier from worn group by tier having count(*) >= 3) s)) / 100.0;
$$;
revoke all on function public.raid_gear_bonus(uuid, text) from public, anon, authenticated;

create or replace function public.start_raid(p_boss text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; d public.raid_boss_defs; n int;
begin
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if (select role from public.village_members where user_id = auth.uid()) <> 'elder' then raise exception 'Only elders can summon a boss.'; end if;
  select * into d from public.raid_boss_defs where id = p_boss;
  if not found then raise exception 'Unknown boss.'; end if;
  if d.tier > 1 and exists (select 1 from public.raid_boss_defs b where b.tier = d.tier - 1
      and not exists (select 1 from public.village_raids r where r.village_id = v and r.boss = b.id and r.status = 'won')) then
    raise exception 'Beat every boss in tier % (%) first. Each tier opens once the one below is beaten.', d.tier - 1,
      coalesce((select t.n from public.raid_tiers t where t.tier = d.tier - 1), 'the tier below');
  end if;
  perform 1 from public.villages where id = v for update;
  perform public.raid_settle(v);
  if exists (select 1 from public.village_raids where village_id = v and status = 'active') then raise exception 'A boss is already here. Beat it first!'; end if;
  select count(*) into n from public.village_members where village_id = v;
  insert into public.village_raids (village_id, boss, scale, started_by, ends_at)
    values (v, p_boss, greatest(1, n), auth.uid(), now() + make_interval(hours => d.hours));
  return public.raid_status();
end $$;

create or replace function public.raid_hit(p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; r public.village_raids; d public.raid_boss_defs; ph jsonb; need int; cur int; e numeric;
        f record; matched boolean; dmg int; done_phase boolean := false; won boolean := false; bonus numeric;
begin
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if p_kind not in ('might', 'magic') then raise exception 'Unknown attack.'; end if;
  perform public.raid_settle(v);
  select * into r from public.village_raids where village_id = v and status = 'active' for update;
  if not found then raise exception 'There is no boss to fight right now.'; end if;
  select * into d from public.raid_boss_defs where id = r.boss;
  ph := d.phases -> r.phase;
  need := (ph->>p_kind)::int * r.scale;
  cur := case when p_kind = 'might' then r.might else r.magic end;
  if cur >= need then raise exception 'That bar is full for this phase. Use the other attack.'; end if;
  insert into public.raid_energy (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  perform 1 from public.raid_energy where user_id = auth.uid() for update;
  e := public.raid_courage(auth.uid());
  if e < 1 then raise exception 'Out of courage. It refills over the hour.'; end if;
  update public.raid_energy set energy = e - 1, at = now() where user_id = auth.uid();
  select * into f from public.raid_fighter(auth.uid());
  bonus := public.farmhand_bonus(auth.uid()) + public.raid_gear_bonus(auth.uid(), p_kind);
  matched := (p_kind = 'might' and f.cls in ('fighter', 'rogue', 'ranger')) or (p_kind = 'magic' and f.cls in ('wizard', 'cleric', 'bard'));
  dmg := least(500, round((25 + 3 * (greatest(1, f.lvl) - 1)) * (case when matched then 1.5 else 1 end) * (0.9 + random() * 0.2) * (1 + bonus)));
  if p_kind = 'might' then r.might := least(need, r.might + dmg); else r.magic := least(need, r.magic + dmg); end if;
  insert into public.raid_hits (raid_id, user_id, actions, might, magic)
    values (r.id, auth.uid(), 1, case when p_kind = 'might' then dmg else 0 end, case when p_kind = 'magic' then dmg else 0 end)
    on conflict (raid_id, user_id) do update set actions = public.raid_hits.actions + 1,
      might = public.raid_hits.might + excluded.might, magic = public.raid_hits.magic + excluded.magic;
  if r.might >= (ph->>'might')::int * r.scale and r.magic >= (ph->>'magic')::int * r.scale then
    done_phase := true;
    if r.phase + 1 >= jsonb_array_length(d.phases) then
      won := true;
      update public.village_raids set might = r.might, magic = r.magic, status = 'won', done_at = now() where id = r.id;
    else
      update public.village_raids set phase = r.phase + 1, might = 0, magic = 0 where id = r.id;
    end if;
  else
    update public.village_raids set might = r.might, magic = r.magic where id = r.id;
  end if;
  return public.raid_status() || jsonb_build_object('hit', jsonb_build_object('dmg', dmg, 'matched', matched, 'kind', p_kind, 'phase_done', done_phase, 'won', won, 'bonus', round(bonus * 100)));
end $$;

create or replace function public.raid_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; r public.village_raids; res jsonb; reward jsonb;
begin
  v := public.my_village();
  if v is null then return jsonb_build_object('in_village', false); end if;
  perform public.raid_settle(v);
  select * into r from public.village_raids where village_id = v order by started_at desc limit 1;
  select to_jsonb(x) into reward from (
    select h.raid_id, d.n as boss_name, rr.status, h.actions, d.tier,
      (h.actions * d.coin_per_action * case when rr.status = 'won' then 1 else 0.5 end
        + case when rr.status = 'won' and h.actions >= 3 then d.victory_bonus else 0 end)::int as coins,
      (h.actions * (15 + 4 * (d.tier - 1)) * case when rr.status = 'won' then 1 else 0.5 end)::int as xp
    from public.raid_hits h join public.village_raids rr on rr.id = h.raid_id join public.raid_boss_defs d on d.id = rr.boss
    where h.user_id = auth.uid() and not h.claimed and rr.status <> 'active'
    order by rr.done_at desc limit 1) x;
  res := jsonb_build_object(
    'in_village', true,
    'role', (select role from public.village_members where user_id = auth.uid()),
    'defs', (select coalesce(jsonb_agg(to_jsonb(d) order by d.sort), '[]'::jsonb) from public.raid_boss_defs d),
    'tiers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.tier), '[]'::jsonb) from public.raid_tiers t),
    'pity', (select coalesce(jsonb_object_agg(p.tier, p.misses), '{}'::jsonb) from public.raid_gear_pity p where p.user_id = auth.uid()),
    'beaten', public.raid_beaten(v),
    'courage', public.raid_courage(auth.uid()), 'courage_max', 12, 'courage_secs', 300,
    'fighter', (select to_jsonb(f) from public.raid_fighter(auth.uid()) f),
    'bonus', public.farmhand_bonus(auth.uid()),
    'reward', reward,
    'now', now());
  if r.id is not null and (r.status = 'active' or r.done_at > now() - interval '1 day') then
    res := res || jsonb_build_object(
      'raid', to_jsonb(r),
      'mine', (select to_jsonb(h) from public.raid_hits h where h.raid_id = r.id and h.user_id = auth.uid()),
      'top', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
        select h.user_id, h.actions, h.might + h.magic as damage from public.raid_hits h where h.raid_id = r.id order by h.actions desc, h.might + h.magic desc limit 8) t),
      'fighters', (select count(*) from public.raid_hits h where h.raid_id = r.id));
  end if;
  return res;
end $$;

create or replace function public.claim_raid_reward() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; rw jsonb; gid bigint; mult numeric; c bigint; tr int; tt public.raid_tiers; m int; piece text; items jsonb; f record; mybar text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v := public.my_village();
  if v is not null then perform public.raid_settle(v); end if;
  select to_jsonb(x) into rw from (
    select h.raid_id, d.n as boss_name, rr.status, h.actions, d.tier,
      (h.actions * d.coin_per_action * case when rr.status = 'won' then 1 else 0.5 end
        + case when rr.status = 'won' and h.actions >= 3 then d.victory_bonus else 0 end)::numeric as coins,
      (h.actions * (15 + 4 * (d.tier - 1)) * case when rr.status = 'won' then 1 else 0.5 end)::int as xp
    from public.raid_hits h join public.village_raids rr on rr.id = h.raid_id join public.raid_boss_defs d on d.id = rr.boss
    where h.user_id = auth.uid() and not h.claimed and rr.status <> 'active'
    order by rr.done_at desc limit 1) x;
  if rw is null then raise exception 'Nothing to collect yet.'; end if;
  update public.raid_hits set claimed = true where raid_id = (rw->>'raid_id')::bigint and user_id = auth.uid() and not claimed;
  if not found then raise exception 'Already collected.'; end if;
  select greatest(1, power(greatest(0, coalesce(fm.value, 0))::numeric / 20000, 0.8)) into mult from public.farms fm where fm.user_id = auth.uid();
  c := round((rw->>'coins')::numeric * coalesce(mult, 1) * (1 + public.farmhand_plunder(auth.uid())));
  tr := greatest(1, coalesce((rw->>'tier')::int, 1));
  items := jsonb_build_object('boss_rune', case when rw->>'status' = 'won' then 2 * tr else tr end);
  -- a win with a real part in it may drop a piece of the tier's gear; sure by the tier's pity-th win
  select * into tt from public.raid_tiers where tier = tr;
  if tt.tier is not null and rw->>'status' = 'won' and (rw->>'actions')::int >= 3 then
    insert into public.raid_gear_pity (user_id, tier) values (auth.uid(), tr) on conflict (user_id, tier) do nothing;
    select misses into m from public.raid_gear_pity where user_id = auth.uid() and tier = tr for update;
    if m + 1 >= tt.pity or random() < tt.drop_chance then
      select * into f from public.raid_fighter(auth.uid());
      mybar := case when f.cls in ('fighter', 'rogue', 'ranger') then 'might' when f.cls in ('wizard', 'cleric', 'bard') then 'magic' else null end;
      -- a piece they don't have yet first, then one that suits their class
      select g.id into piece from public.raid_gear_defs g left join public.farms fm on fm.user_id = auth.uid()
        where g.tier = tr
        order by (jsonb_typeof(fm.state->'inv'->g.id) = 'number' and (fm.state->'inv'->>g.id)::numeric > 0) nulls first,
                 (g.bar = 'both' or g.bar = mybar or mybar is null) desc, random()
        limit 1;
      update public.raid_gear_pity set misses = 0 where user_id = auth.uid() and tier = tr;
      if piece is not null then items := items || jsonb_build_object(piece, 1); end if;
    else
      update public.raid_gear_pity set misses = m + 1 where user_id = auth.uid() and tier = tr;
    end if;
  end if;
  insert into public.farm_grants (user_id, kind, coins, xp, ref, items)
    values (auth.uid(), 'raid', greatest(0, c), greatest(0, (rw->>'xp')::int), rw->>'raid_id', items) returning id into gid;
  return rw || jsonb_build_object('coins', c, 'grant', gid, 'items', items, 'gear', piece);
end $$;

-- a top-tier share on a big farm can pass two billion coins
alter table public.farm_grants alter column coins type bigint;
