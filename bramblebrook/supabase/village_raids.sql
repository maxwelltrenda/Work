-- Applied to the Bramblebrook project on 2026-11-24 as migration "village_raids" (then resized by raid_scale_small_villages.sql).
-- Village bosses: an elder summons a boss; for the next two days every neighbour attacks it, from the website
-- or from Claude. Each phase has two bars: Might (fighters, rogues and rangers hit it hardest) and Magic
-- (wizards, clerics and bards). Fill both to move on; beat the last phase to win. Courage pays for attacks
-- and refills over the hour. Rewards are for effort: coins per attack, plus a victory share.
create table public.raid_boss_defs (
  id text primary key,
  n text not null,
  blurb text not null,
  art int not null,                       -- cell in the game's boss.webp strip
  hours int not null default 48,
  coin_per_action int not null default 12,
  victory_bonus int not null default 400,
  phases jsonb not null,                  -- [{n, text, might, magic}]; might/magic are per neighbour (at least 3)
  sort int not null
);
insert into public.raid_boss_defs (id, n, blurb, art, hours, coin_per_action, victory_bonus, phases, sort) values
  ('bramble_wyrm', 'The Bramble Wyrm', 'A wyrm of moss and thorn has coiled itself around the old mill. Its brambles creep closer to the fields every night.', 0, 48, 12, 400,
   '[{"n":"It Stirs","text":"The coils shift and the mill groans. Hack at the thorns before they reach the barns.","might":150,"magic":150},
     {"n":"The Thorns Tighten","text":"Brambles burst from the ground around it. Burn and cut them back together.","might":150,"magic":150},
     {"n":"The Wyrm Rears Up","text":"It lifts its great head over the rooftops. One last push for the valley!","might":150,"magic":150}]', 1),
  ('stone_colossus', 'The Quarry Colossus', 'Something huge woke in the old quarry and is walking toward the village one slow, rumbling step at a time.', 1, 48, 12, 450,
   '[{"n":"Rumbling","text":"Every step shakes the windows. Crack its stone hide.","might":160,"magic":140},
     {"n":"Rockfall","text":"It tears up boulders and hurls them. Shield the houses and keep striking.","might":160,"magic":140},
     {"n":"The Heart of Stone","text":"A blue light glows deep in its chest. Aim for the heart!","might":160,"magic":140}]', 2),
  ('frost_wolf', 'The Frost Wolf', 'Down from the highlands with the first snow, a wolf as big as a cart. Its howl freezes the duck pond solid.', 2, 48, 12, 450,
   '[{"n":"Snow on the Wind","text":"The wolf circles the village in the blizzard. Drive it back from the coops.","might":140,"magic":160},
     {"n":"The Long Howl","text":"Its howl turns the air to ice. Warm the village with fire and song.","might":140,"magic":160},
     {"n":"Cornered","text":"Backed against the frozen pond, it fights hardest of all. Hold steady!","might":140,"magic":160}]', 3),
  ('storm_tortoise', 'The Storm Tortoise', 'An ancient sea tortoise has hauled itself onto the cove, bringing a storm that will not leave.', 3, 48, 12, 500,
   '[{"n":"High Tide","text":"Waves crash over the jetty. Push the great beast back toward the sea.","might":150,"magic":150},
     {"n":"Thunder Shell","text":"Lightning crackles across its shell. Break its storm with spells and blades.","might":150,"magic":150},
     {"n":"The Old One Wakes","text":"Its eyes open fully for the first time in a hundred years. Show it the valley is not afraid.","might":150,"magic":150}]', 4);

create table public.village_raids (
  id bigint generated always as identity primary key,
  village_id uuid not null references public.villages (id) on delete cascade,
  boss text not null references public.raid_boss_defs (id),
  scale int not null,                     -- neighbours when summoned, at least 3
  phase int not null default 0,           -- current phase, from 0
  might int not null default 0,           -- progress on this phase's bars
  magic int not null default 0,
  status text not null default 'active' check (status in ('active', 'won', 'lost')),
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  done_at timestamptz
);
create unique index village_raids_one_active on public.village_raids (village_id) where status = 'active';
create index village_raids_recent on public.village_raids (village_id, started_at desc);
create table public.raid_hits (
  raid_id bigint not null references public.village_raids (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  actions int not null default 0,
  might int not null default 0,
  magic int not null default 0,
  claimed boolean not null default false,
  primary key (raid_id, user_id)
);
create table public.raid_energy (
  user_id uuid primary key references auth.users (id) on delete cascade,
  energy numeric not null default 12,
  at timestamptz not null default now()
);
alter table public.raid_boss_defs enable row level security;
alter table public.village_raids enable row level security;
alter table public.raid_hits enable row level security;
alter table public.raid_energy enable row level security;
create policy "boss list is public" on public.raid_boss_defs for select to authenticated using (true);
create policy "neighbours see their village's bosses" on public.village_raids for select to authenticated using (village_id = (select public.my_village()));
create policy "neighbours see who fought" on public.raid_hits for select to authenticated
  using (raid_id in (select r.id from public.village_raids r where r.village_id = (select public.my_village())));
create policy "players see their own courage" on public.raid_energy for select to authenticated using (user_id = (select auth.uid()));

-- the player's class and class level, read from their saved farm (combat.cls, combat.xp)
create or replace function public.raid_fighter(p_user uuid, out cls text, out lvl int)
language plpgsql security definer set search_path = '' stable as $$
declare xp numeric := 0; spent numeric := 0; step numeric;
begin
  select coalesce(s.data->'combat'->>'cls', ''),
         case when coalesce(s.data->'combat'->>'xp', '') ~ '^[0-9]+(\.[0-9]+)?$' then (s.data->'combat'->>'xp')::numeric else 0 end
    into cls, xp from public.saves s where s.user_id = p_user;
  cls := coalesce(cls, ''); xp := coalesce(xp, 0); lvl := 1;
  while lvl < 20 loop
    step := round(100 * power(lvl, 1.8));
    exit when xp < spent + step;
    spent := spent + step; lvl := lvl + 1;
  end loop;
end $$;

-- a boss whose time ran out slinks away
create or replace function public.raid_settle(p_village uuid) returns void
language sql security definer set search_path = '' as $$
  update public.village_raids set status = 'lost', done_at = ends_at
  where village_id = p_village and status = 'active' and ends_at <= now();
$$;

create or replace function public.raid_courage(p_user uuid) returns numeric
language sql security definer set search_path = '' stable as $$
  select coalesce((select least(12, energy + extract(epoch from (now() - at)) / 300) from public.raid_energy where user_id = p_user), 12);
$$;

-- everything the boss screen shows, in one answer
create or replace function public.raid_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; r public.village_raids; res jsonb; reward jsonb;
begin
  v := public.my_village();
  if v is null then return jsonb_build_object('in_village', false); end if;
  perform public.raid_settle(v);
  select * into r from public.village_raids where village_id = v order by started_at desc limit 1;
  select to_jsonb(x) into reward from (
    select h.raid_id, d.n as boss_name, rr.status, h.actions,
      (h.actions * d.coin_per_action * case when rr.status = 'won' then 1 else 0.5 end
        + case when rr.status = 'won' and h.actions >= 3 then d.victory_bonus else 0 end)::int as coins,
      (h.actions * 15 * case when rr.status = 'won' then 1 else 0.5 end)::int as xp
    from public.raid_hits h join public.village_raids rr on rr.id = h.raid_id join public.raid_boss_defs d on d.id = rr.boss
    where h.user_id = auth.uid() and not h.claimed and rr.status <> 'active'
    order by rr.done_at desc limit 1) x;
  res := jsonb_build_object(
    'in_village', true,
    'role', (select role from public.village_members where user_id = auth.uid()),
    'defs', (select coalesce(jsonb_agg(to_jsonb(d) order by d.sort), '[]'::jsonb) from public.raid_boss_defs d),
    'courage', public.raid_courage(auth.uid()), 'courage_max', 12, 'courage_secs', 300,
    'fighter', (select to_jsonb(f) from public.raid_fighter(auth.uid()) f),
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

create or replace function public.start_raid(p_boss text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; d public.raid_boss_defs; n int;
begin
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if (select role from public.village_members where user_id = auth.uid()) <> 'elder' then raise exception 'Only elders can summon a boss.'; end if;
  select * into d from public.raid_boss_defs where id = p_boss;
  if not found then raise exception 'Unknown boss.'; end if;
  perform 1 from public.villages where id = v for update;
  perform public.raid_settle(v);
  if exists (select 1 from public.village_raids where village_id = v and status = 'active') then raise exception 'A boss is already here. Beat it first!'; end if;
  select count(*) into n from public.village_members where village_id = v;
  insert into public.village_raids (village_id, boss, scale, started_by, ends_at)
    values (v, p_boss, greatest(3, n), auth.uid(), now() + make_interval(hours => d.hours));
  return public.raid_status();
end $$;

create or replace function public.raid_hit(p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; r public.village_raids; d public.raid_boss_defs; ph jsonb; need int; cur int; e numeric;
        f record; matched boolean; dmg int; done_phase boolean := false; won boolean := false;
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
  matched := (p_kind = 'might' and f.cls in ('fighter', 'rogue', 'ranger')) or (p_kind = 'magic' and f.cls in ('wizard', 'cleric', 'bard'));
  dmg := round((10 + 2 * f.lvl) * (case when matched then 1.6 else 1 end) * (0.85 + random() * 0.3));
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
  return public.raid_status() || jsonb_build_object('hit', jsonb_build_object('dmg', dmg, 'matched', matched, 'kind', p_kind, 'phase_done', done_phase, 'won', won));
end $$;

-- the player's share of the last boss they fought, paid once
create or replace function public.claim_raid_reward() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; rw jsonb;
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
  return rw;
end $$;

do $$
declare f text;
begin
  foreach f in array array['raid_fighter(uuid)', 'raid_settle(uuid)', 'raid_courage(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['raid_status()', 'start_raid(text)', 'raid_hit(text)', 'claim_raid_reward()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- the connector plays these too
create or replace function public.svc_act(p_user uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_user is null then raise exception 'No player'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  p_args := coalesce(p_args, '{}'::jsonb);
  case p_action
    when 'create_village' then r := to_jsonb(public.create_village(p_args->>'p_name', p_args->>'p_crest', p_args->>'p_motto'));
    when 'join_village' then perform public.join_village((p_args->>'p_village')::uuid);
    when 'leave_village' then perform public.leave_village();
    when 'donate_to_village' then r := to_jsonb(public.donate_to_village((p_args->>'p_amount')::bigint));
    when 'upgrade_village_building' then r := to_jsonb(public.upgrade_village_building(p_args->>'p_building'));
    when 'post_village_message' then perform public.post_village_message(p_args->>'p_body');
    when 'promote_village_member' then perform public.promote_village_member((p_args->>'p_user')::uuid);
    when 'set_village_details' then perform public.set_village_details(p_args->>'p_motto', (p_args->>'p_open')::boolean);
    when 'list_villages' then select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into r from public.list_villages() x;
    when 'touch_presence' then r := to_jsonb(public.touch_presence());
    when 'get_profiles' then
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into r
      from public.get_profiles(array(select jsonb_array_elements_text(coalesce(p_args->'p_ids', '[]'::jsonb))::uuid)) x;
    when 'raid_status' then r := public.raid_status();
    when 'start_raid' then r := public.start_raid(p_args->>'p_boss');
    when 'raid_hit' then r := public.raid_hit(p_args->>'p_kind');
    when 'claim_raid_reward' then r := public.claim_raid_reward();
    else raise exception 'Unknown action';
  end case;
  return coalesce(r, 'null'::jsonb);
end $$;
